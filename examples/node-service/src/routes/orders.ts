import { getOrder } from '../db';

export async function ordersRoute(id: string) {
  return getOrder(id);
}
