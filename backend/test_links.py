import asyncio
import httpx
import re
from app.db.database import db_read_session, dict_from_row
from app.services.tririga_admin_client import TririgaAdminClient

async def main():
    with db_read_session() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM servers WHERE id = 106")
        server = dict_from_row(cur.fetchone())

    base_url = f"{server['protocol']}://{server['host']}:{server['port']}"
    async with httpx.AsyncClient(verify=False, timeout=15) as client:
        auth = await TririgaAdminClient._authenticate_client(
            client, base_url, '/html/en/default/admin', server['username'], server['password']
        )
        print('Authenticated:', auth)
        res = await client.get(f"{base_url}/html/en/default/admin/errorLogMain.jsp")
        links = re.findall(r'href=["\']([^"\']*downloadLogFile\.jsp[^"\']*)["\']', res.text, re.IGNORECASE)
        print(f'Found {len(links)} links:')
        for l in links[:30]:
            print('  ', l)

if __name__ == '__main__':
    asyncio.run(main())
