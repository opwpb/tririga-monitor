import { TririgaServer } from '../types';

/**
 * Determines whether a TRIRIGA server belongs to a production environment.
 * Excludes preprod, dev, test, uat, and proto naming patterns while matching
 * common production prefixes and naming conventions.
 */
export function isProdServer(server: TririgaServer): boolean {
  const name = (server.name || '').toLowerCase().trim();
  const cluster = (server.cluster_name || '').toLowerCase().trim();
  const host = (server.host || '').toLowerCase().trim();

  // Explicit non-production signals take precedence
  const isNonProd = (
    name.includes('preprod') || name.includes('pre-prod') || host.includes('preprod') || host.includes('pre-prod') ||
    name.includes('proto') || host.includes('proto') ||
    name.includes('dev') || host.includes('dev') ||
    name.includes('test') || host.includes('test') ||
    name.includes('stage') || host.includes('stage') ||
    name.includes('uat') || host.includes('uat')
  );
  if (isNonProd) return false;

  // Production matches
  return (
    name.startsWith('prod') ||
    name.includes('production') ||
    cluster.includes('prod') ||
    host.includes('prod') ||
    name === 'prod app1' ||
    name === 'prod app2'
  );
}

/**
 * Returns the IDs of all production servers in the list.
 */
export function getProdServerIds(servers: TririgaServer[]): number[] {
  return servers.filter(isProdServer).map(s => s.id);
}

/**
 * Finds the primary production server (e.g. app1 or first prod server), falling back to first server.
 */
export function findPrimaryProdServer(servers: TririgaServer[]): TririgaServer | undefined {
  if (!servers || servers.length === 0) return undefined;
  const prodServers = servers.filter(isProdServer);
  if (prodServers.length === 0) return servers[0];

  const app1 = prodServers.find(s => s.name.toLowerCase().includes('app1'));
  return app1 || prodServers[0];
}

/**
 * Segregates servers into production and non-production lists.
 */
export function segregateServers(servers: TririgaServer[]): {
  prodServers: TririgaServer[];
  nonProdServers: TririgaServer[];
} {
  const prod: TririgaServer[] = [];
  const nonProd: TririgaServer[] = [];

  servers.forEach(s => {
    if (isProdServer(s)) {
      prod.push(s);
    } else {
      nonProd.push(s);
    }
  });

  return {
    prodServers: prod.length > 0 ? prod : servers,
    nonProdServers: nonProd,
  };
}
