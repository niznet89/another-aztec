import { AliasHash } from '@aztec/barretenberg/account_id';
import { EthAddress, GrumpkinAddress } from '@aztec/barretenberg/address';
import { toBufferBE } from '@aztec/barretenberg/bigint_buffer';
import { BridgeCallData } from '@aztec/barretenberg/bridge_call_data';
import { ProofId } from '@aztec/barretenberg/client_proofs';
import {
  OffchainAccountData,
  OffchainDefiClaimData,
  OffchainDefiDepositData,
  OffchainJoinSplitData,
} from '@aztec/barretenberg/offchain_tx_data';
import { InnerProofData, RollupProofData } from '@aztec/barretenberg/rollup_proof';
import { numToUInt32BE } from '@aztec/barretenberg/serialize';
import { TxId } from '@aztec/barretenberg/tx_id';
import { ViewingKey } from '@aztec/barretenberg/viewing_key';
import { WorldStateConstants } from '@aztec/barretenberg/world_state';
import { randomBytes } from '@aztec/barretenberg/crypto';
import { EthereumProvider } from '@aztec/barretenberg/blockchain';
import { keccak256, Web3Signer } from '@aztec/sdk';

const numToBuffer = (num: number) => numToUInt32BE(num, 32);

const randomLeafHash = () => randomBytes(32);

const randomNullifier = () => Buffer.concat([Buffer.alloc(16), randomBytes(16)]);

const MAX_NUMBER_OF_ROLLUPS_PER_TEST = RollupProofData.NUM_BRIDGE_CALLS_PER_BLOCK + 10; // arbitrary choice of 10. We currently have a test that uses numberOfBridgeCalls + 3...

const extendRoots = (roots: Buffer[], size = MAX_NUMBER_OF_ROLLUPS_PER_TEST) => [
  ...roots,
  ...[...Array(size - roots.length)].map(() => randomBytes(32)),
];

// Roots fetched form default @ "barretenberg.js/src/environment/init/init_config.js"
const dataRoots = extendRoots([Buffer.from('1417c092da90cfd39679299b8e381dd295dba6074b410e830ef6d3b7040b6eac', 'hex')]);
const nullifierRoots = extendRoots([
  Buffer.from('0225131cf7530ba9f617dba641b32020a746a6e0124310c09aac7c7c8a2e0ce5', 'hex'),
]);
const dataRootRoots = extendRoots([
  Buffer.from('08ddeab28afc61bd560f0153f7399c9bb437c7cd280d0f4c19322227fcd80e05', 'hex'),
]);
const defiRoots = extendRoots([WorldStateConstants.EMPTY_DEFI_ROOT]);

export class InnerProofOutput {
  constructor(
    public innerProofs: InnerProofData[],
    public signatures: Buffer[],
    public totalTxFees: bigint[],
    public offchainTxData: Buffer[],
  ) {}
}

export const createDepositProof = async (
  amount: bigint,
  depositorAddress: EthAddress,
  provider: EthereumProvider,
  assetId: number,
  txFee = 0n,
) => {
  const innerProof = new InnerProofData(
    ProofId.DEPOSIT,
    randomLeafHash(),
    randomLeafHash(),
    randomNullifier(),
    randomNullifier(),
    toBufferBE(amount + txFee, 32),
    depositorAddress.toBuffer32(),
    numToBuffer(assetId),
  );
  const message = new TxId(innerProof.txId).toDepositSigningData();
  const signature = await new Web3Signer(provider).signMessage(message, depositorAddress);

  const totalTxFees: bigint[] = [];
  totalTxFees[assetId] = txFee;

  const offchainTxData = new OffchainJoinSplitData([ViewingKey.random(), ViewingKey.random()]);

  return new InnerProofOutput([innerProof], [signature], totalTxFees, [offchainTxData.toBuffer()]);
};

export const createWithdrawProof = (amount: bigint, withdrawalAddress: EthAddress, assetId: number, txFee = 0n) => {
  const innerProof = new InnerProofData(
    ProofId.WITHDRAW,
    randomLeafHash(),
    randomLeafHash(),
    randomNullifier(),
    randomNullifier(),
    toBufferBE(amount + txFee, 32),
    withdrawalAddress.toBuffer32(),
    numToBuffer(assetId),
  );
  const totalTxFees: bigint[] = [];
  totalTxFees[assetId] = txFee;

  const offchainTxData = new OffchainJoinSplitData([ViewingKey.random(), ViewingKey.random()]);

  return new InnerProofOutput([innerProof], [], totalTxFees, [offchainTxData.toBuffer()]);
};

export const createSendProof = (assetId = 1, txFee = 0n) => {
  const innerProof = new InnerProofData(
    ProofId.SEND,
    randomLeafHash(),
    randomLeafHash(),
    randomNullifier(),
    randomNullifier(),
    Buffer.alloc(32),
    Buffer.alloc(32),
    Buffer.alloc(32),
  );
  const totalTxFees: bigint[] = [];
  totalTxFees[assetId] = txFee;

  const offchainTxData = new OffchainJoinSplitData([ViewingKey.random(), ViewingKey.random()]);

  return new InnerProofOutput([innerProof], [], totalTxFees, [offchainTxData.toBuffer()]);
};

export const createAccountProof = () => {
  const innerProof = new InnerProofData(
    ProofId.ACCOUNT,
    randomLeafHash(),
    randomLeafHash(),
    randomNullifier(),
    Buffer.alloc(32),
    Buffer.alloc(32),
    Buffer.alloc(32),
    Buffer.alloc(32),
  );

  const offchainTxData = new OffchainAccountData(GrumpkinAddress.random(), AliasHash.random());

  return new InnerProofOutput([innerProof], [], [], [offchainTxData.toBuffer()]);
};

export const createDefiDepositProof = (bridgeCallData: BridgeCallData, inputValue: bigint, txFee = 0n) => {
  const innerProof = new InnerProofData(
    ProofId.DEFI_DEPOSIT,
    randomLeafHash(),
    randomLeafHash(),
    randomNullifier(),
    randomNullifier(),
    Buffer.alloc(32),
    Buffer.alloc(32),
    Buffer.alloc(32),
  );
  const totalTxFees: bigint[] = [];
  totalTxFees[bridgeCallData.inputAssetIdA] = txFee;

  const offchainTxData = new OffchainDefiDepositData(
    bridgeCallData,
    randomBytes(32),
    new GrumpkinAddress(randomBytes(64)),
    inputValue,
    txFee,
    ViewingKey.random(),
  );

  return new InnerProofOutput([innerProof], [], totalTxFees, [offchainTxData.toBuffer()]);
};

export const createDefiClaimProof = (bridgeCallData: BridgeCallData, txFee = 0n) => {
  const innerProof = new InnerProofData(
    ProofId.DEFI_CLAIM,
    randomLeafHash(),
    randomLeafHash(),
    randomNullifier(),
    randomNullifier(),
    Buffer.alloc(32),
    Buffer.alloc(32),
    Buffer.alloc(32),
  );
  const totalTxFees: bigint[] = [];
  totalTxFees[bridgeCallData.inputAssetIdA] = txFee;

  const offchainTxData = new OffchainDefiClaimData();

  return new InnerProofOutput([innerProof], [], totalTxFees, [offchainTxData.toBuffer()]);
};

export const mergeInnerProofs = (output: InnerProofOutput[]) => {
  const totalTxFees: bigint[] = [];
  output.forEach(o => {
    o.totalTxFees.forEach((fee, assetId) => (totalTxFees[assetId] = fee + (totalTxFees[assetId] || 0n)));
  });
  return new InnerProofOutput(
    output.map(o => o.innerProofs).flat(),
    output
      .map(o => o.signatures)
      .filter(s => s)
      .flat(),
    totalTxFees,
    output.map(o => o.offchainTxData).flat(),
  );
};

export class DefiInteractionData {
  static EMPTY = new DefiInteractionData(BridgeCallData.ZERO, BigInt(0));

  constructor(public readonly bridgeCallData: BridgeCallData, public readonly totalInputValue: bigint) {}
}

interface RollupProofOptions {
  rollupId?: number;
  rollupSize?: number;
  dataStartIndex?: number;
  numberOfAssets?: number;
  numberOfDefiInteraction?: number;
  previousDefiInteractionHash?: Buffer;
  defiInteractionData?: DefiInteractionData[];
  prevInteractionResult?: Buffer[];
  feeLimit?: bigint;
  feeDistributorAddress?: EthAddress;
}

export const createSigData = (
  proofData: Buffer,
  providerAddress: EthAddress,
  feeLimit: bigint,
  feeDistributorAddress: EthAddress,
) => {
  const message = Buffer.concat([
    proofData.slice(0, RollupProofData.LENGTH_ROLLUP_HEADER_INPUTS),
    providerAddress.toBuffer(),
    toBufferBE(feeLimit, 32),
    feeDistributorAddress.toBuffer(),
  ]);
  return keccak256(message);
};

export const createRollupProof = (
  innerProofOutput: InnerProofOutput,
  {
    rollupId = 0,
    rollupSize = 2,
    dataStartIndex,
    numberOfAssets = RollupProofData.NUMBER_OF_ASSETS,
    numberOfDefiInteraction = RollupProofData.NUM_BRIDGE_CALLS_PER_BLOCK,
    previousDefiInteractionHash,
    defiInteractionData = [],
    prevInteractionResult = [],
    feeDistributorAddress = EthAddress.random(),
  }: RollupProofOptions = {},
) => {
  const { innerProofs, totalTxFees, offchainTxData } = innerProofOutput;

  // Start from 16 as falafel defaults to have 16 notes
  const dataStartIndexBuf = numToBuffer(dataStartIndex === undefined ? 8 + rollupId * rollupSize * 2 : dataStartIndex);

  const totalTxFeePublicInputs = totalTxFees.filter(fee => fee).map(fee => toBufferBE(fee, 32));
  for (let i = totalTxFeePublicInputs.length; i < numberOfAssets; ++i) {
    totalTxFeePublicInputs.push(toBufferBE(0n, 32));
  }

  const interactionData = [...defiInteractionData];
  for (let i = interactionData.length; i < numberOfDefiInteraction; ++i) {
    interactionData[i] = DefiInteractionData.EMPTY;
  }
  const bridgeCallDatas = interactionData.map(d => d.bridgeCallData);
  const defiDepositSums = interactionData.map(d => d.totalInputValue);

  const interactionNoteCommitments = [...prevInteractionResult];
  for (let i = prevInteractionResult.length; i < numberOfDefiInteraction; ++i) {
    interactionNoteCommitments.push(Buffer.alloc(32));
  }

  const assetIds: Set<number> = new Set();
  innerProofs.forEach(proof => {
    switch (proof.proofId) {
      case ProofId.DEFI_DEPOSIT:
      case ProofId.DEFI_CLAIM: {
        const bridgeCallData = BridgeCallData.fromBuffer(proof.publicAssetId);
        assetIds.add(bridgeCallData.inputAssetIdA);
        break;
      }
      case ProofId.ACCOUNT:
        break;
      default:
        assetIds.add(proof.publicAssetId.readUInt32BE(28));
    }
  });

  const innerProofLen = rollupSize;
  const padding = Buffer.alloc(32 * InnerProofData.NUM_PUBLIC_INPUTS * (innerProofLen - innerProofs.length), 0);

  const proofData = Buffer.concat([
    numToBuffer(rollupId),
    numToBuffer(rollupSize),
    dataStartIndexBuf,
    dataRoots[rollupId],
    dataRoots[rollupId + 1],
    nullifierRoots[rollupId],
    nullifierRoots[rollupId + 1],
    dataRootRoots[rollupId],
    dataRootRoots[rollupId + 1],
    defiRoots[rollupId],
    defiRoots[rollupId + 1],
    ...bridgeCallDatas.map(id => id.toBuffer()),
    ...defiDepositSums.map(sum => toBufferBE(sum, 32)),
    ...[...assetIds].map(assetId => numToBuffer(assetId)),
    ...Array(numberOfAssets - assetIds.size).fill(numToBuffer(2 ** 30)),
    ...totalTxFeePublicInputs,
    ...interactionNoteCommitments,
    previousDefiInteractionHash || WorldStateConstants.INITIAL_INTERACTION_HASH,
    feeDistributorAddress.toBuffer32(),
    numToBuffer(rollupSize), // ??
    ...innerProofs.map(p => p.toBuffer()),
    padding,
  ]);

  const rollupProofData = RollupProofData.fromBuffer(proofData);

  return {
    ...innerProofOutput,
    encodedProofData: rollupProofData.encode(),
    rollupProofData,
    offchainTxData,
  };
};
