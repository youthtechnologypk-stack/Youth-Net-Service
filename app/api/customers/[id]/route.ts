import { deleteCustomerInDb } from '../../../../src/db/routerRepo';

/**
 * Route Handler: DELETE /api/customers/:id
 * Permanently delete customer record from PostgreSQL and persistent storage
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Customer ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deleteCustomerInDb(id);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Customer ${id} deleted permanently from database.`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete customer' }),
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
