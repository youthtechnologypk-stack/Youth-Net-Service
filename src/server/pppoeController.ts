import { Request, Response } from 'express';
import { RouterOSAPI } from 'node-routeros';
import { getRouterCredentials, getAllRouters, saveCustomerInDb, deleteCustomerInDb } from '../db/routerRepo.js';

export interface AddPppoeUserPayload {
  username: string;
  password: string;
  service?: 'pppoe' | 'any';
  profile: string;
  remoteAddress?: string;
  localAddress?: string;
  comment?: string;
  callerId?: string; // Optional MAC-lock
  routerId?: string;
  // Subscriber billing info
  name?: string;
  phone?: string;
  address?: string;
  areaNode?: string;
  packageId?: string;
}

/**
 * Controller: Add PPPoE User / Secret to MikroTik RouterOS v7 & PostgreSQL
 * Excludes mock data - executes directly on physical or defined router.
 */
export async function addPppoeUserController(req: Request, res: Response) {
  const {
    username,
    password,
    service = 'pppoe',
    profile = 'default',
    remoteAddress,
    localAddress,
    comment,
    callerId,
    routerId,
    name,
    phone,
    address,
    areaNode,
    packageId,
  }: AddPppoeUserPayload = req.body;

  const cleanUsername = String(username || '').trim();
  const cleanPassword = String(password || '').trim();

  if (!cleanUsername || !cleanPassword) {
    return res.status(400).json({
      success: false,
      error: 'Username and password are required fields.',
    });
  }

  // Retrieve router credentials
  let targetRouterId = routerId;
  let creds = targetRouterId ? await getRouterCredentials(targetRouterId) : null;

  if (!creds) {
    const routers = await getAllRouters();
    if (routers.length > 0) {
      targetRouterId = routers[0].id;
      creds = await getRouterCredentials(routers[0].id);
    }
  }

  if (!creds) {
    return res.status(404).json({
      success: false,
      error: 'No active MikroTik router found in database to provision secret.',
    });
  }

  const routerApi = new RouterOSAPI({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password || '',
    timeout: 8,
    tls: creds.useSsl ? { rejectUnauthorized: false } : undefined,
  });
  routerApi.on('error', () => {});

  let mikrotikId: string | null = null;

  try {
    // 1. Connect to RouterOS v7
    await routerApi.connect();

    // 2. Check if secret already exists on RouterOS
    const existingSecrets = await routerApi.write('/ppp/secret/print', [
      `?name=${cleanUsername}`,
    ]);

    if (existingSecrets && existingSecrets.length > 0) {
      return res.status(409).json({
        success: false,
        error: `PPPoE user '${cleanUsername}' already exists on router ${creds.host}.`,
      });
    }

    // 3. Add PPPoE Secret (/ppp/secret/add)
    const writeParams: string[] = [
      `=name=${cleanUsername}`,
      `=password=${cleanPassword}`,
      `=service=${service}`,
      `=profile=${profile}`,
      `=comment=${comment || `${name || cleanUsername} | ${phone || ''}`}`,
    ];

    if (remoteAddress) {
      writeParams.push(`=remote-address=${remoteAddress.trim()}`);
    }
    if (localAddress) {
      writeParams.push(`=local-address=${localAddress.trim()}`);
    }
    if (callerId) {
      writeParams.push(`=caller-id=${callerId.trim()}`);
    }

    const addResult = await routerApi.write('/ppp/secret/add', writeParams);
    mikrotikId = addResult && addResult.length > 0 ? (addResult[0] as any).ret : null;
  } catch (apiErr: any) {
    return res.status(502).json({
      success: false,
      error: `RouterOS API communication failed on ${creds.host}:${creds.port}: ${apiErr.message}`,
    });
  } finally {
    try {
      (routerApi as any).connector?.destroy?.();
      routerApi.removeAllListeners();
      routerApi.close().catch(() => {});
    } catch {}
  }

  // 4. Save subscriber in PostgreSQL database
  try {
    const subscriberId = `cust-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const savedCustomer = await saveCustomerInDb({
      id: subscriberId,
      name: (name || cleanUsername).trim(),
      phone: (phone || '').trim(),
      address: (address || '').trim(),
      areaNode: (areaNode || 'Default').trim(),
      pppoeUsername: cleanUsername,
      pppoePassword: cleanPassword,
      service,
      packageId: packageId || profile,
      assignedIp: remoteAddress || '',
      routerId: targetRouterId || '',
      status: 'active',
      comment: comment || '',
    });

    return res.status(201).json({
      success: true,
      message: `PPPoE user '${cleanUsername}' created on MikroTik (${creds.host}) and saved to database.`,
      routerId: targetRouterId,
      mikrotikId,
      customer: savedCustomer,
    });
  } catch (dbErr: any) {
    // If DB fails after router write, report exact error
    return res.status(500).json({
      success: false,
      error: `User provisioned on MikroTik (${mikrotikId}), but database record failed: ${dbErr.message}`,
    });
  }
}

/**
 * Controller: Delete PPPoE User / Secret from MikroTik RouterOS & PostgreSQL
 * Performs atomic dual-cleanup:
 * 1. Kicks live active session (/ppp/active/remove) to immediately disconnect user
 * 2. Deletes secret (/ppp/secret/remove)
 * 3. Archives / deletes record from PostgreSQL
 */
export async function deletePppoeUserController(req: Request, res: Response) {
  const username = String(req.params.username || req.body?.username || '').trim();
  const routerId = String(req.query.routerId || req.body?.routerId || '').trim();

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required to delete PPPoE subscriber.',
    });
  }

  // Retrieve router credentials
  let targetRouterId = routerId;
  let creds = targetRouterId ? await getRouterCredentials(targetRouterId) : null;

  if (!creds) {
    const routers = await getAllRouters();
    if (routers.length > 0) {
      targetRouterId = routers[0].id;
      creds = await getRouterCredentials(routers[0].id);
    }
  }

  let sessionKilled = false;
  let secretDeleted = false;
  let routerError: string | null = null;

  if (creds) {
    const routerApi = new RouterOSAPI({
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password || '',
      timeout: 8,
      tls: creds.useSsl ? { rejectUnauthorized: false } : undefined,
    });
    routerApi.on('error', () => {});

    try {
      await routerApi.connect();

      // 1. Find & Kill active sessions
      const activeSessions = await routerApi.write('/ppp/active/print', [
        `?name=${username}`,
      ]);

      if (activeSessions && activeSessions.length > 0) {
        for (const session of activeSessions) {
          const sessId = (session as any)['.id'];
          if (sessId) {
            await routerApi.write('/ppp/active/remove', [`=.id=${sessId}`]);
            sessionKilled = true;
          }
        }
      }

      // 2. Find & Remove secret
      const secrets = await routerApi.write('/ppp/secret/print', [
        `?name=${username}`,
      ]);

      if (secrets && secrets.length > 0) {
        for (const sec of secrets) {
          const secretId = (sec as any)['.id'];
          if (secretId) {
            await routerApi.write('/ppp/secret/remove', [`=.id=${secretId}`]);
            secretDeleted = true;
          }
        }
      }
    } catch (err: any) {
      routerError = err.message;
    } finally {
      try {
        (routerApi as any).connector?.destroy?.();
        routerApi.removeAllListeners();
        routerApi.close().catch(() => {});
      } catch {}
    }
  }

  // 3. Delete / Archive in database
  try {
    await deleteCustomerInDb(username);

    return res.status(200).json({
      success: true,
      message: `PPPoE subscriber '${username}' successfully removed.`,
      terminatedActiveSession: sessionKilled,
      removedSecret: secretDeleted,
      routerHost: creds?.host,
      routerWarning: routerError || undefined,
    });
  } catch (dbErr: any) {
    return res.status(500).json({
      success: false,
      error: `Failed to remove user from database: ${dbErr.message}`,
    });
  }
}

/**
 * Controller: Enable or Disable PPPoE User on MikroTik
 * When disabled: immediately kicks active session to drop PPP connection
 */
export async function togglePppoeUserController(req: Request, res: Response) {
  const username = String(req.params.username || req.body?.username || '').trim();
  const { disabled, routerId } = req.body;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username is required.',
    });
  }

  let targetRouterId = routerId;
  let creds = targetRouterId ? await getRouterCredentials(targetRouterId) : null;

  if (!creds) {
    const routers = await getAllRouters();
    if (routers.length > 0) {
      targetRouterId = routers[0].id;
      creds = await getRouterCredentials(routers[0].id);
    }
  }

  if (!creds) {
    return res.status(404).json({
      success: false,
      error: 'Router credentials not found.',
    });
  }

  const routerApi = new RouterOSAPI({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password || '',
    timeout: 8,
    tls: creds.useSsl ? { rejectUnauthorized: false } : undefined,
  });
  routerApi.on('error', () => {});

  try {
    await routerApi.connect();

    // 1. Locate secret ID
    const secrets = await routerApi.write('/ppp/secret/print', [
      `?name=${username}`,
    ]);

    if (!secrets || secrets.length === 0) {
      return res.status(404).json({
        success: false,
        error: `PPPoE user '${username}' not found on router ${creds.host}.`,
      });
    }

    const secretId = (secrets[0] as any)['.id'];
    await routerApi.write('/ppp/secret/set', [
      `=.id=${secretId}`,
      `=disabled=${disabled ? 'yes' : 'no'}`,
    ]);

    // 2. If disabled, terminate active session immediately
    let sessionKilled = false;
    if (disabled) {
      const active = await routerApi.write('/ppp/active/print', [
        `?name=${username}`,
      ]);
      if (active && active.length > 0) {
        for (const act of active) {
          const actId = (act as any)['.id'];
          if (actId) {
            await routerApi.write('/ppp/active/remove', [`=.id=${actId}`]);
            sessionKilled = true;
          }
        }
      }
    }

    return res.json({
      success: true,
      message: `PPPoE user '${username}' ${disabled ? 'disabled' : 'enabled'} on ${creds.host}.`,
      disabled: Boolean(disabled),
      sessionKilled,
    });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      error: `RouterOS error: ${err.message}`,
    });
  } finally {
    try {
      (routerApi as any).connector?.destroy?.();
      routerApi.removeAllListeners();
      routerApi.close().catch(() => {});
    } catch {}
  }
}
