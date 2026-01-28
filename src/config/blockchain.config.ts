import { ChainIds } from '../common/variables';
import { ChainConnectionInfo } from '../modules/blockchain/interfaces';

function loadChainInfo(): ChainConnectionInfo[] {
  return [
    {
      rpcInfos: [
        {
          url: 'https://rpc.testnet.evm.dusk.network',
          queryBlockRange: 100,
        },
      ],
      chainId: ChainIds.DUSK_TESTNET,
    },
    {
      rpcInfos: [
        {
          url: 'https://atlantic.dplabs-internal.com',
          queryBlockRange: 100,
        },
      ],
      chainId: ChainIds.PHAROS_TESTNET,
    },
  ];
}

export default loadChainInfo;
