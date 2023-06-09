import { depositToWeth, approveWeth, getTokenBalance } from './index.js';
import { Contract } from 'ethers';
import { Web3Provider } from '@ethersproject/providers';
import { MainnetAddresses } from './mainnet_addresses.js';
import { EthereumProvider } from '@aztec/barretenberg/blockchain';
import { EthAddress } from '@aztec/barretenberg/address';
import { ISwapRouter } from '../abis.js';

const supportedAssets = [
  MainnetAddresses.Tokens['DAI'],
  MainnetAddresses.Tokens['USDC'],
  MainnetAddresses.Tokens['WBTC'],
  MainnetAddresses.Tokens['WETH'],
];

export const addressesAreSame = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const fixEthersStackTrace = (err: Error) => {
  err.stack! += new Error().stack;
  throw err;
};
export class Uniswap {
  private contract: Contract;
  private ethersProvider: Web3Provider;

  constructor(private provider: EthereumProvider) {
    this.ethersProvider = new Web3Provider(provider);
    this.contract = new Contract(MainnetAddresses.Contracts['UNISWAP'], ISwapRouter.abi, this.ethersProvider);
  }

  static isSupportedAsset(assetAddress: EthAddress) {
    return supportedAssets.some(asset => addressesAreSame(assetAddress.toString(), asset));
  }

  getAddress() {
    return this.contract.address;
  }

  async swapFromEth(
    spender: EthAddress,
    recipient: EthAddress,
    token: { erc20Address: EthAddress; amount: bigint },
    amountInMaximum: bigint,
  ) {
    if (!Uniswap.isSupportedAsset(token.erc20Address)) {
      throw new Error('Asset not supported');
    }
    await depositToWeth(spender, amountInMaximum, this.provider);
    if (addressesAreSame(token.erc20Address.toString(), MainnetAddresses.Tokens['WETH'])) {
      return BigInt(0);
    }
    const params = {
      tokenIn: MainnetAddresses.Tokens['WETH'],
      tokenOut: token.erc20Address.toString(),
      fee: BigInt(3000),
      recipient: recipient.toString(),
      deadline: `0x${BigInt(Date.now() + 36000000).toString(16)}`,
      amountOut: token.amount,
      amountInMaximum,
      sqrtPriceLimitX96: BigInt(0),
    };
    await approveWeth(spender, EthAddress.fromString(this.contract.address), params.amountInMaximum, this.provider);
    const amountBefore = await getTokenBalance(token.erc20Address, recipient, this.provider);
    const swapTx = await this.contract
      .connect(this.ethersProvider.getSigner(spender.toString()))
      .exactOutputSingle(params)
      .catch(fixEthersStackTrace);
    await swapTx.wait();
    const amountAfter = await getTokenBalance(token.erc20Address, recipient, this.provider);
    const amountReceived = BigInt(amountAfter) - BigInt(amountBefore);
    return amountReceived;
  }
}
