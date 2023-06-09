import { EthAddress } from '../address/index.js';
import { EthereumProvider } from './ethereum_provider.js';
import { TxHash } from './tx_hash.js';

export interface EthereumBlock {
  baseFeePerGas: bigint;
}

export class EthereumRpc {
  constructor(protected provider: EthereumProvider) {}

  public async blockNumber() {
    const result = await this.provider.request({ method: 'eth_blockNumber' });
    return Number(result);
  }

  public async getChainId() {
    const result = await this.provider.request({ method: 'eth_chainId' });
    return Number(result);
  }

  public async getAccounts() {
    const result: string[] = await this.provider.request({ method: 'eth_accounts' });
    return result.map(EthAddress.fromString);
  }

  public async getTransactionCount(addr: EthAddress) {
    const result = await this.provider.request({
      method: 'eth_getTransactionCount',
      params: [addr.toString(), 'latest'],
    });
    return Number(result);
  }

  public async getBalance(addr: EthAddress) {
    const result = await this.provider.request({
      method: 'eth_getBalance',
      params: [addr.toString(), 'latest'],
    });
    return BigInt(result);
  }

  /**
   * TODO: Return proper type with converted properties.
   */
  public async getTransactionByHash(txHash: TxHash): Promise<any> {
    const result = await this.provider.request({ method: 'eth_getTransactionByHash', params: [txHash.toString()] });
    return result;
  }

  /**
   * TODO: Return proper type with converted properties.
   * For now just baseFeePerGas.
   */
  public async getBlockByNumber(numberOrTag: number | 'latest' | 'earliest' | 'pending', fullTxs = false) {
    const result = await this.provider.request({ method: 'eth_getBlockByNumber', params: [numberOrTag, fullTxs] });
    return {
      ...result,
      baseFeePerGas: BigInt(result.baseFeePerGas),
    } as EthereumBlock;
  }
}
