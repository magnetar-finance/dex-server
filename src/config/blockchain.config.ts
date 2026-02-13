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
        {
          url: 'https://api.zan.top/node/v1/pharos/atlantic/5c34a51f74114a7a9c201593fb45a73e',
          queryBlockRange: 100,
        },
      ],
      chainId: ChainIds.PHAROS_TESTNET,
    },
    {
      rpcInfos: [
        {
          url: 'https://gcp-2.seismictest.net/rpc',
          queryBlockRange: 100,
        },
      ],
      chainId: ChainIds.SEISMIC_TESTNET,
    },
  ];
}

export default loadChainInfo;
