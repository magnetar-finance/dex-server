export interface RPCInfo {
  url: string;
  queryBlockRange?: number;
}

export interface ChainConnectionInfo {
  rpcInfos: RPCInfo[];
  chainId: number;
}
