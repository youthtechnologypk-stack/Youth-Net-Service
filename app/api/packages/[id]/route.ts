import { deletePackageInDb } from '../../../../src/db/routerRepo';

/**
 * Route Handler: DELETE /api/packages/:id
 * Permanently delete bandwidth package from PostgreSQL and persistent storage
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Package ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deletePackageInDb(id);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Bandwidth profile ${id} deleted permanently from database.`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete package' }),
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
