const url = process.env.DATABASE_URL;

export async function getOrder(id: string) {
  return { id, url };
}
