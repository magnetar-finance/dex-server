export interface ContractDeployEventPayload {
  address: string;
  block: number;
  chainId: number;
}

export enum EventTypes {
  V2_POOL_DEPLOYED = 'v2.pool.deployed',
  CL_POOL_DEPLOYED = 'cl.pool.deployed',
}
