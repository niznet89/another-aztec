/* eslint-disable @typescript-eslint/no-unused-vars */
import { EthAddress } from '@aztec/barretenberg/address';
import { Asset, EthereumProvider, SendTxOptions, TxHash } from '@aztec/barretenberg/blockchain';
import { Web3Provider } from '@ethersproject/providers';
import { fromBaseUnits, toBaseUnits } from '../../units.js';

const fixEthersStackTrace = (err: Error) => {
  err.stack! += new Error().stack;
  throw err;
};

export class EthAsset implements Asset {
  private provider: Web3Provider;

  constructor(provider: EthereumProvider, private minConfirmations = 1) {
    this.provider = new Web3Provider(provider);
  }

  getStaticInfo() {
    return {
      address: EthAddress.ZERO,
      name: 'Eth',
      symbol: 'ETH',
      decimals: 18,
      gasLimit: 30000,
    };
  }

  getUserNonce(account: EthAddress) {
    return Promise.resolve(BigInt(0));
  }

  async balanceOf(account: EthAddress) {
    const balance = await this.provider.getBalance(account.toString());
    return BigInt(balance.toString());
  }

  allowance(owner: EthAddress, receiver: EthAddress): Promise<bigint> {
    throw new Error('Allowance unsupported for ETH.');
  }

  approve(value: bigint, owner: EthAddress, receiver: EthAddress): Promise<TxHash> {
    throw new Error('Approve unsupported for ETH.');
  }

  mint(value: bigint, account: EthAddress): Promise<TxHash> {
    throw new Error('Mint unsupported for ETH.');
  }

  async transfer(value: bigint, from: EthAddress, to: EthAddress, options: SendTxOptions = {}) {
    const provider = options.provider ? new Web3Provider(options.provider) : this.provider;
    const signer = provider.getSigner(from.toString());
    const tx = await signer
      .sendTransaction({
        to: to.toString(),
        value: `0x${value.toString(16)}`,
        gasLimit: options.gasLimit,
        nonce: options.nonce,
      })
      .catch(fixEthersStackTrace);
    const receipt = await tx.wait(this.minConfirmations);
    return TxHash.fromString(receipt.transactionHash);
  }

  public fromBaseUnits(value: bigint, precision?: number) {
    return fromBaseUnits(value, 18, precision);
  }

  public toBaseUnits(value: string) {
    return toBaseUnits(value, 18);
  }
}
