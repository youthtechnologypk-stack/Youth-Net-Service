import { deleteCustomerInDb } from '../../../../../src/db/routerRepo';

/**
 * Route Handler: DELETE /api/mikrotik/secrets/:username
 * Permanently delete PPPoE secret from PostgreSQL customers table and persistent storage
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const { username } = params;
    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username / identifier is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deleteCustomerInDb(username);

    return new Response(
      JSON.stringify({
        success: true,
        message: `PPPoE subscriber ${username} deleted permanently from database.`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete secret' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function OPTIONS() {
  return new Response('', {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
