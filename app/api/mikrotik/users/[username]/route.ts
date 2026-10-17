import { deletePppoeUserFromMikrotik } from '@/src/lib/mikrotikConnection';
import { getRouterCredentials, getAllRouters, deleteCustomerInDb } from '@/src/db/routerRepo';

/**
 * Route Handler: DELETE /api/mikrotik/users/:username
 * Dual-cleanup: Terminate active session + delete secret on MikroTik, archive customer in DB
 */
export async function DELETE(
  req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const { username } = params;
    const url = new URL(req.url);
    const routerId = url.searchParams.get('routerId') || '';

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let creds = routerId ? await getRouterCredentials(routerId) : null;
    if (!creds) {
      const all = await getAllRouters();
      if (all.length > 0) {
        creds = await getRouterCredentials(all[0].id);
      }
    }

    let mikrotikResult: any = { success: true, killedSession: false, deletedSecret: false };
    if (creds) {
      mikrotikResult = await deletePppoeUserFromMikrotik(
        {
          host: creds.host,
          port: creds.port,
          username: creds.username,
          password: creds.password,
          useSsl: creds.useSsl,
        },
        username
      );
    }

    await deleteCustomerInDb(username);

    return new Response(
      JSON.stringify({
        success: true,
        message: `PPPoE subscriber ${username} removed from MikroTik and archived in database.`,
        mikrotik: mikrotikResult,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Delete failure' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
