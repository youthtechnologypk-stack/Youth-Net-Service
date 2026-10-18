import { deleteRouter, updateRouter, getRouterCredentials } from '../../../../../src/db/routerRepo';

/**
 * Route Handler: PUT /api/mikrotik/routers/:id
 * Update router configuration and credentials in database
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Router ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const {
      name,
      host,
      ipAddress,
      port,
      apiPort,
      username,
      password,
      useSsl,
      model,
      location,
      wanInterface,
      walledGardenPool,
    } = body;

    const finalHost = (host || ipAddress || '').trim();
    const finalPort = Number(port || apiPort);

    const updates: any = {};
    if (name) updates.name = name.trim();
    if (finalHost) updates.ipAddress = finalHost;
    if (finalPort) updates.apiPort = finalPort;
    if (username) updates.username = username.trim();
    if (useSsl !== undefined) updates.useSsl = Boolean(useSsl);
    if (model) updates.model = model.trim();
    if (location) updates.location = location.trim();
    if (wanInterface) updates.wanInterface = wanInterface.trim();
    if (walledGardenPool) updates.walledGardenPool = walledGardenPool.trim();

    const updated = await updateRouter(id, updates, password);

    if (!updated) {
      return new Response(
        JSON.stringify({ success: false, error: `Router ${id} not found.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Router ${updated.name} updated successfully`,
        router: updated,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to update router' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Route Handler: DELETE /api/mikrotik/routers/:id
 * Remove router configuration from database
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Router ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deleteRouter(id);
    return new Response(
      JSON.stringify({ success: true, message: `Router ${id} deleted successfully.` }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete router' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
