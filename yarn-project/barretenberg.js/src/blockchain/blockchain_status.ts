import { EthAddress } from '../address/index.js';

type Jsonify<T> = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  [P in keyof T]: T[P] extends EthAddress | bigint | Buffer ? string : T[P] extends Object ? Jsonify<T[P]> : T[P];
};

// TODO: Move to TxType module.
export enum TxType {
  DEPOSIT,
  TRANSFER,
  WITHDRAW_TO_WALLET,
  WITHDRAW_HIGH_GAS,
  ACCOUNT,
  DEFI_DEPOSIT,
  DEFI_CLAIM,
}
export const numTxTypes = 7;

export function isDefiDepositTx(txType: TxType) {
  return txType === TxType.DEFI_DEPOSIT;
}

export function isAccountTx(txType: TxType) {
  return txType === TxType.ACCOUNT;
}

export interface BlockchainAsset {
  address: EthAddress;
  decimals: number;
  symbol: string;
  name: string;
  gasLimit: number;
}

export type BlockchainAssetJson = Jsonify<BlockchainAsset>;

export const blockchainAssetToJson = ({ address, ...asset }: BlockchainAsset): BlockchainAssetJson => ({
  ...asset,
  address: address.toLowerCaseAddress(),
});

export const blockchainAssetFromJson = ({ address, ...asset }: BlockchainAssetJson): BlockchainAsset => ({
  ...asset,
  address: EthAddress.fromString(address),
});

export interface BlockchainBridge {
  id: number;
  address: EthAddress;
  gasLimit: number;
}

export type BlockchainBridgeJson = Jsonify<BlockchainBridge>;

export const blockchainBridgeToJson = ({ address, ...bridge }: BlockchainBridge): BlockchainBridgeJson => ({
  ...bridge,
  address: address.toLowerCaseAddress(),
});

export const blockchainBridgeFromJson = ({ address, ...bridge }: BlockchainBridgeJson): BlockchainBridge => ({
  ...bridge,
  address: EthAddress.fromString(address),
});

export interface BlockchainStatus {
  chainId: number;
  rollupContractAddress: EthAddress;
  permitHelperContractAddress: EthAddress;
  verifierContractAddress: EthAddress;
  bridgeDataProvider: EthAddress;
  nextRollupId: number;
  dataSize: number;
  dataRoot: Buffer;
  nullRoot: Buffer;
  rootRoot: Buffer;
  defiRoot: Buffer;
  defiInteractionHashes: Buffer[];
  escapeOpen: boolean;
  allowThirdPartyContracts: boolean;
  numEscapeBlocksRemaining: number;
  assets: BlockchainAsset[];
  bridges: BlockchainBridge[];
}

export type BlockchainStatusJson = Jsonify<BlockchainStatus>;

export function blockchainStatusToJson(status: BlockchainStatus): BlockchainStatusJson {
  return {
    ...status,
    rollupContractAddress: status.rollupContractAddress.toLowerCaseAddress(),
    permitHelperContractAddress: status.permitHelperContractAddress.toLowerCaseAddress(),
    verifierContractAddress: status.verifierContractAddress.toLowerCaseAddress(),
    bridgeDataProvider: status.bridgeDataProvider.toLowerCaseAddress(),
    dataRoot: status.dataRoot.toString('hex'),
    nullRoot: status.nullRoot.toString('hex'),
    rootRoot: status.rootRoot.toString('hex'),
    defiRoot: status.defiRoot.toString('hex'),
    defiInteractionHashes: status.defiInteractionHashes.map(v => v.toString('hex')),
    assets: status.assets.map(blockchainAssetToJson),
    bridges: status.bridges.map(blockchainBridgeToJson),
  };
}

export function blockchainStatusFromJson(json: BlockchainStatusJson): BlockchainStatus {
  return {
    ...json,
    rollupContractAddress: EthAddress.fromString(json.rollupContractAddress),
    permitHelperContractAddress: EthAddress.fromString(json.permitHelperContractAddress),
    verifierContractAddress: EthAddress.fromString(json.verifierContractAddress),
    bridgeDataProvider: EthAddress.fromString(json.bridgeDataProvider),
    dataRoot: Buffer.from(json.dataRoot, 'hex'),
    nullRoot: Buffer.from(json.nullRoot, 'hex'),
    rootRoot: Buffer.from(json.rootRoot, 'hex'),
    defiRoot: Buffer.from(json.defiRoot, 'hex'),
    defiInteractionHashes: json.defiInteractionHashes.map(f => Buffer.from(f, 'hex')),
    assets: json.assets.map(blockchainAssetFromJson),
    bridges: json.bridges.map(blockchainBridgeFromJson),
  };
}

export interface BlockchainStatusSource {
  getBlockchainStatus(): BlockchainStatus;
}
