import { addPppoeUserToMikrotik } from '@/src/lib/mikrotikConnection';
import { getRouterCredentials, getAllRouters, saveCustomerInDb } from '@/src/db/routerRepo';

/**
 * Route Handler: POST /api/mikrotik/users
 * Provision new PPPoE user to RouterOS + PostgreSQL customers table
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      username,
      password,
      service = 'pppoe',
      profile,
      remoteAddress,
      remoteIp,
      staticIp,
      comment,
      name,
      phone,
      address,
      areaNode,
      packageId,
      routerId,
    } = body;

    const finalUsername = String(username || '').trim();
    const finalPassword = String(password || '').trim();
    const finalProfile = String(profile || 'default').trim();
    const finalRemote = String(remoteAddress || remoteIp || staticIp || '').trim();
    const finalComment = String(comment || `${name || finalUsername} | ${phone || ''}`).trim();

    if (!finalUsername || !finalPassword) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username and password are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let targetRouterId = routerId;
    let creds = targetRouterId ? await getRouterCredentials(targetRouterId) : null;
    if (!creds) {
      const all = await getAllRouters();
      if (all.length > 0) {
        targetRouterId = all[0].id;
        creds = await getRouterCredentials(all[0].id);
      }
    }

    if (!creds) {
      return new Response(
        JSON.stringify({ success: false, error: 'No active MikroTik router found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const routerOsRes = await addPppoeUserToMikrotik(
      {
        host: creds.host,
        port: creds.port,
        username: creds.username,
        password: creds.password,
        useSsl: creds.useSsl,
      },
      {
        username: finalUsername,
        password: finalPassword,
        service,
        profile: finalProfile,
        remoteAddress: finalRemote || undefined,
        comment: finalComment,
      }
    );

    if (!routerOsRes.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `MikroTik error on ${creds.host}: ${routerOsRes.error}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const custId = `cust-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const customer = await saveCustomerInDb({
      id: custId,
      name: (name || finalUsername).trim(),
      phone: (phone || '+92 300 0000000').trim(),
      address: (address || 'Central Distribution Area').trim(),
      areaNode: (areaNode || 'Sector G-11').trim(),
      pppoeUsername: finalUsername,
      pppoePassword: finalPassword,
      service,
      packageId: packageId || finalProfile,
      assignedIp: finalRemote || `10.50.${Math.floor(Math.random() * 40 + 10)}.${Math.floor(Math.random() * 240 + 10)}`,
      routerId: targetRouterId,
      status: 'active',
      comment: finalComment,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `PPPoE user ${finalUsername} provisioned on MikroTik (${creds.host}) and saved to DB.`,
        user: {
          id: custId,
          username: finalUsername,
          password: finalPassword,
          service,
          profile: finalProfile,
          remoteAddress: finalRemote,
          routerId: targetRouterId,
          mikrotikId: routerOsRes.id,
        },
        customer,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Provision failure' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
