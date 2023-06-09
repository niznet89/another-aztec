import { AliasHash } from '@aztec/barretenberg/account_id';
import { EthAddress, GrumpkinAddress } from '@aztec/barretenberg/address';
import { toBufferBE } from '@aztec/barretenberg/bigint_buffer';
import { TxHash } from '@aztec/barretenberg/blockchain';
import { Block } from '@aztec/barretenberg/block_source';
import { DefiInteractionEvent } from '@aztec/barretenberg/block_source';
import { BridgeCallData, virtualAssetIdFlag, virtualAssetIdPlaceholder } from '@aztec/barretenberg/bridge_call_data';
import { ProofData, ProofId } from '@aztec/barretenberg/client_proofs';
import { Grumpkin } from '@aztec/barretenberg/ecc';
import { HashPath } from '@aztec/barretenberg/merkle_tree';
import {
  deriveNoteSecret,
  NoteAlgorithms,
  NoteDecryptor,
  SingleNoteDecryptor,
  TreeClaimNote,
  TreeNote,
} from '@aztec/barretenberg/note_algorithms';
import {
  OffchainAccountData,
  OffchainDefiClaimData,
  OffchainDefiDepositData,
  OffchainJoinSplitData,
} from '@aztec/barretenberg/offchain_tx_data';
import { InnerProofData, RollupProofData } from '@aztec/barretenberg/rollup_proof';
import { RollupProvider } from '@aztec/barretenberg/rollup_provider';
import { TxId } from '@aztec/barretenberg/tx_id';
import { BarretenbergWasm } from '@aztec/barretenberg/wasm';
import { randomBytes } from 'crypto';
import { BlockContext } from '../block_context/block_context.js';
import { CoreAccountTx, CoreDefiTx, CorePaymentTx, CoreUserTx, PaymentProofId } from '../core_tx/index.js';
import { BulkUserStateUpdateData, Database } from '../database/index.js';
import { Note } from '../note/index.js';
import { UserData } from '../user/index.js';
import { UserState } from './index.js';
import { mock } from 'jest-mock-extended';

describe('user state', () => {
  let grumpkin: Grumpkin;
  let noteAlgos: NoteAlgorithms;
  let noteDecryptor: NoteDecryptor;
  let db: ReturnType<typeof mock<Database>>;
  let rollupProvider: ReturnType<typeof mock<RollupProvider>>;
  let userState: UserState;
  let user: UserData;
  let generatedHashPaths: { [key: number]: HashPath } = {};
  let inputNotes: Note[] = [];

  const createEphemeralPrivKey = () => grumpkin.getRandomFr();

  const createEphemeralKeyPair = () => {
    const ephPrivKey = grumpkin.getRandomFr();
    const ephPubKey = new GrumpkinAddress(grumpkin.mul(Grumpkin.generator, ephPrivKey));
    return { ephPrivKey, ephPubKey };
  };

  const createUser = () => {
    const accountPrivateKey = randomBytes(32);
    const accountPublicKey = new GrumpkinAddress(grumpkin.mul(Grumpkin.generator, accountPrivateKey));
    return {
      accountPrivateKey,
      accountPublicKey,
      syncedToRollup: -1,
    };
  };

  const createHashPath = (depth: number) => {
    const bufs: Buffer[][] = [];
    for (let i = 0; i < depth; i++) {
      bufs.push([randomBytes(32), randomBytes(32)]);
    }
    return new HashPath(bufs);
  };

  const createBlockContext = (block: Block) => {
    const decoded = RollupProofData.decode(block.encodedRollupProofData);
    return {
      rollup: decoded,
      block: {
        mined: block.mined,
        offchainTxData: block.offchainTxData,
        interactionResult: block.interactionResult,
      },
      getBlockSubtreeHashPath: function (index: number) {
        const path = createHashPath(11);
        generatedHashPaths[index] = path;
        return Promise.resolve(path);
      },
    } as BlockContext;
  };

  const addInputNote = (
    owner: GrumpkinAddress,
    ownerAccountRequired: boolean,
    assetId: number,
    value: bigint,
    nullifier: Buffer,
  ) => {
    const treeNote1 = new TreeNote(
      owner,
      value,
      assetId,
      ownerAccountRequired,
      randomBytes(32),
      Buffer.alloc(32),
      randomBytes(32),
    );
    inputNotes.push(new Note(treeNote1, randomBytes(32), nullifier, true, false));
  };

  beforeAll(async () => {
    const barretenberg = await BarretenbergWasm.new();
    grumpkin = new Grumpkin(barretenberg);
    noteAlgos = new NoteAlgorithms(barretenberg);
    noteDecryptor = new SingleNoteDecryptor(barretenberg);
  });

  beforeEach(async () => {
    user = createUser();

    // Default Database mock handlers.
    db = mock<Database>();
    db.getPendingUserTxs.mockResolvedValue([]);
    db.getNoteByNullifier.mockImplementation((nullifier: Buffer) =>
      Promise.resolve(inputNotes.find(n => n.nullifier.equals(nullifier))),
    );
    db.getPendingNotes.mockResolvedValue([]);
    db.getUnclaimedDefiTxs.mockResolvedValue([]);
    db.getNotes.mockResolvedValue([]);
    db.getUser.mockResolvedValue(user);
    db.bulkUserStateUpdate.mockImplementation(async (data: BulkUserStateUpdateData): Promise<void> => {
      await Promise.all(
        [
          data.updateUserArgs.map(args => db.updateUser(...args)),
          data.addSpendingKeyArgs.map(args => db.addSpendingKey(...args)),
          data.upsertAccountTxArgs.map(args => db.upsertAccountTx(...args)),
          data.upsertPaymentTxArgs.map(args => db.upsertPaymentTx(...args)),
          data.upsertDefiTxArgs.map(args => db.upsertDefiTx(...args)),
          data.addNoteArgs.map(args => db.addNote(...args)),
          data.nullifyNoteArgs.map(args => db.nullifyNote(...args)),
        ].flat(),
      );
    });

    rollupProvider = mock<RollupProvider>();
    rollupProvider.getLatestRollupId.mockResolvedValue(0);
    rollupProvider.getBlocks.mockResolvedValue([]);
    rollupProvider.getPendingTxs.mockResolvedValue([]);

    inputNotes = [];
    generatedHashPaths = {};

    userState = new UserState(user, grumpkin, noteAlgos, noteDecryptor, db as any, rollupProvider as any);
    await userState.init();
  });

  const createNote = (
    assetId: number,
    value: bigint,
    userId: GrumpkinAddress,
    userAccountRequired: boolean,
    inputNullifier: Buffer,
    allowChain: boolean,
  ) => {
    const ephPrivKey = createEphemeralPrivKey();
    const treeNote = TreeNote.createFromEphPriv(
      userId,
      value,
      assetId,
      userAccountRequired,
      inputNullifier,
      ephPrivKey,
      grumpkin,
    );
    const commitment = noteAlgos.valueNoteCommitment(treeNote);
    const nullifier = Buffer.alloc(0);
    const note = new Note(treeNote, commitment, nullifier, allowChain, false);
    const viewingKey = treeNote.createViewingKey(ephPrivKey, grumpkin);
    return { note, viewingKey };
  };

  const createClaimNote = (
    bridgeCallData: BridgeCallData,
    value: bigint,
    userId: GrumpkinAddress,
    userAccountRequired: boolean,
    inputNullifier: Buffer,
  ) => {
    const { ephPrivKey, ephPubKey } = createEphemeralKeyPair();

    const partialStateSecret = deriveNoteSecret(userId, ephPrivKey, grumpkin);

    const partialState = noteAlgos.valueNotePartialCommitment(partialStateSecret, userId, userAccountRequired);
    const partialClaimNote = new TreeClaimNote(
      value,
      bridgeCallData,
      0, // defiInteractionNonce
      BigInt(0), // fee
      partialState,
      inputNullifier,
    );
    return { partialClaimNote, partialStateSecretEphPubKey: ephPubKey, partialStateSecret };
  };

  const generatePaymentProof = ({
    proofId = ProofId.SEND as PaymentProofId,
    proofSender = user,
    proofSenderAccountRequired = true,
    newNoteOwner = createUser(),
    newNoteOwnerAccountRequired = true,
    assetId = 1,
    inputNoteValue1 = 0n,
    inputNoteValue2 = 0n,
    outputNoteValue1 = 0n,
    outputNoteValue2 = 0n,
    publicValue = 0n,
    publicOwner = EthAddress.ZERO,
    txFee = 0n,
    allowChain = 0,
    isPadding = false,
    createValidNoteCommitments = true,
    txRefNo = 0,
  } = {}) => {
    // Input notes
    const nullifier1 = isPadding
      ? Buffer.alloc(32)
      : noteAlgos.valueNoteNullifier(randomBytes(32), proofSender.accountPrivateKey);
    const nullifier2 = isPadding
      ? Buffer.alloc(32)
      : noteAlgos.valueNoteNullifier(randomBytes(32), proofSender.accountPrivateKey);
    if (inputNoteValue1) {
      addInputNote(proofSender.accountPublicKey, proofSenderAccountRequired, assetId, inputNoteValue1, nullifier1);
    }
    if (inputNoteValue2) {
      addInputNote(proofSender.accountPublicKey, proofSenderAccountRequired, assetId, inputNoteValue2, nullifier2);
    }

    // Output notes
    const notes = [
      createNote(
        assetId,
        outputNoteValue1,
        newNoteOwner.accountPublicKey,
        newNoteOwnerAccountRequired,
        nullifier1,
        [1, 3].includes(allowChain),
      ),
      createNote(
        assetId,
        outputNoteValue2,
        proofSender.accountPublicKey,
        proofSenderAccountRequired,
        nullifier2,
        [2, 3].includes(allowChain),
      ),
    ];
    const note1Commitment = createValidNoteCommitments ? notes[0].note.commitment : randomBytes(32);
    const note2Commitment = createValidNoteCommitments ? notes[1].note.commitment : randomBytes(32);
    const viewingKeys = isPadding ? [] : notes.map(n => n.viewingKey);

    const proofData = new InnerProofData(
      proofId,
      note1Commitment,
      note2Commitment,
      nullifier1,
      nullifier2,
      toBufferBE(publicValue, 32),
      publicOwner.toBuffer32(),
      Buffer.alloc(32),
    );

    const offchainTxData = new OffchainJoinSplitData(viewingKeys, txRefNo);

    const tx = new CorePaymentTx(
      new TxId(proofData.txId),
      proofSender.accountPublicKey,
      proofId,
      assetId,
      publicValue,
      publicOwner,
      outputNoteValue1 + outputNoteValue2 + txFee,
      outputNoteValue1,
      outputNoteValue2,
      newNoteOwner.accountPublicKey.equals(user.accountPublicKey),
      proofSender.accountPublicKey.equals(user.accountPublicKey),
      txRefNo,
      new Date(),
    );

    return { proofData, offchainTxData, tx, outputNotes: notes.map(n => n.note) };
  };

  const generateDepositProof = ({
    recipient = user,
    newNoteOwnerAccountRequired = true,
    assetId = 1,
    depositValue = 100n,
    ethAddress = EthAddress.random(),
    txFee = 8n,
    txRefNo = 0,
    createValidNoteCommitments = true,
  } = {}) =>
    generatePaymentProof({
      proofId: ProofId.DEPOSIT,
      newNoteOwner: recipient,
      newNoteOwnerAccountRequired,
      assetId,
      outputNoteValue1: depositValue,
      publicValue: depositValue + txFee,
      publicOwner: ethAddress,
      txFee,
      createValidNoteCommitments,
      txRefNo,
    });

  const generateWithdrawProof = ({
    proofSender = user,
    proofSenderAccountRequired = true,
    recipient = EthAddress.random(),
    assetId = 1,
    inputNoteValue1 = 60n,
    inputNoteValue2 = 40n,
    withdrawValue = 100n,
    txFee = 8n,
    txRefNo = 0,
    createValidNoteCommitments = true,
  } = {}) =>
    generatePaymentProof({
      proofId: ProofId.WITHDRAW,
      proofSender,
      proofSenderAccountRequired,
      newNoteOwner: proofSender,
      newNoteOwnerAccountRequired: proofSenderAccountRequired,
      assetId,
      inputNoteValue1,
      inputNoteValue2,
      outputNoteValue1: 0n,
      outputNoteValue2: inputNoteValue1 + inputNoteValue2 - withdrawValue - txFee,
      publicValue: withdrawValue + txFee,
      publicOwner: recipient,
      txFee,
      createValidNoteCommitments,
      txRefNo,
    });

  const generateTransferProof = ({
    proofSender = user,
    proofSenderAccountRequired = true,
    newNoteOwner = createUser(),
    newNoteOwnerAccountRequired = true,
    assetId = 1,
    inputNoteValue1 = 80n,
    inputNoteValue2 = 40n,
    outputNoteValue1 = 64n,
    outputNoteValue2 = 36n,
    txFee = 8n,
    allowChain = 2,
    createValidNoteCommitments = true,
    txRefNo = 0,
  } = {}) =>
    generatePaymentProof({
      proofId: ProofId.SEND,
      proofSender,
      proofSenderAccountRequired,
      newNoteOwner,
      newNoteOwnerAccountRequired,
      assetId,
      inputNoteValue1,
      inputNoteValue2,
      outputNoteValue1,
      outputNoteValue2,
      txFee,
      allowChain,
      createValidNoteCommitments,
      txRefNo,
    });

  const generateAccountProof = ({
    userId = user.accountPublicKey,
    aliasHash = AliasHash.random(),
    newAccountPublicKey = userId,
    newSpendingPublicKey1 = GrumpkinAddress.random(),
    newSpendingPublicKey2 = GrumpkinAddress.random(),
    txRefNo = 0,
  } = {}) => {
    const create = newAccountPublicKey.equals(userId);
    const migrate = !create;
    const note1 = randomBytes(32);
    const note2 = randomBytes(32);
    const nullifier1 = create ? noteAlgos.accountAliasHashNullifier(aliasHash) : Buffer.alloc(32);
    const nullifier2 = create || migrate ? noteAlgos.accountPublicKeyNullifier(userId) : Buffer.alloc(32);
    const proofData = new InnerProofData(
      ProofId.ACCOUNT,
      note1,
      note2,
      nullifier1,
      nullifier2,
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(32),
    );
    const offchainTxData = new OffchainAccountData(
      newAccountPublicKey,
      aliasHash,
      newSpendingPublicKey1.x(),
      newSpendingPublicKey2.x(),
      txRefNo,
    );
    return {
      proofData,
      offchainTxData,
    };
  };

  const generateDefiDepositProof = ({
    bridgeCallData = BridgeCallData.random(),
    inputNoteValue1 = 0n,
    inputNoteValue2 = 0n,
    outputNoteValue = 0n,
    depositValue = 0n,
    txFee = 0n,
    proofSender = user,
    proofSenderAccountRequired = true,
    claimNoteRecipient = user.accountPublicKey,
    txRefNo = 0,
  } = {}) => {
    const assetId = bridgeCallData.inputAssetIdA;
    const nullifier1 = noteAlgos.valueNoteNullifier(randomBytes(32), proofSender.accountPrivateKey);
    const nullifier2 = noteAlgos.valueNoteNullifier(randomBytes(32), proofSender.accountPrivateKey);
    addInputNote(proofSender.accountPublicKey, true, assetId, inputNoteValue1, nullifier1);
    addInputNote(proofSender.accountPublicKey, true, assetId, inputNoteValue2, nullifier2);

    const dummyNote = createNote(
      assetId,
      0n,
      proofSender.accountPublicKey,
      proofSenderAccountRequired,
      randomBytes(32),
      true,
    );
    const changeNote = createNote(
      assetId,
      outputNoteValue,
      proofSender.accountPublicKey,
      proofSenderAccountRequired,
      nullifier2,
      true,
    );
    const { partialClaimNote, partialStateSecretEphPubKey } = createClaimNote(
      bridgeCallData,
      depositValue,
      claimNoteRecipient,
      proofSenderAccountRequired,
      nullifier1,
    );
    const partialClaimNoteCommitment = noteAlgos.claimNotePartialCommitment(partialClaimNote);
    const changeNoteCommitment = changeNote.note.commitment;
    const viewingKeys = [changeNote.viewingKey];
    const proofData = new InnerProofData(
      ProofId.DEFI_DEPOSIT,
      partialClaimNoteCommitment,
      changeNoteCommitment,
      nullifier1,
      nullifier2,
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(32),
    );
    const offchainTxData = new OffchainDefiDepositData(
      bridgeCallData,
      partialClaimNote.partialState,
      partialStateSecretEphPubKey,
      depositValue,
      txFee,
      viewingKeys[0],
      txRefNo,
    );
    const partialStateSecret = deriveNoteSecret(partialStateSecretEphPubKey, proofSender.accountPrivateKey, grumpkin);
    const tx = new CoreDefiTx(
      new TxId(proofData.txId),
      proofSender.accountPublicKey,
      bridgeCallData,
      depositValue,
      txFee,
      txRefNo,
      new Date(),
      partialClaimNote.partialState,
      partialStateSecret,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return { proofData, offchainTxData, tx, outputNotes: [dummyNote.note, changeNote.note] };
  };

  const generateDefiClaimProof = ({
    owner = user,
    accountRequired = true,
    bridgeCallData = BridgeCallData.random(),
    outputValueA = 0n,
    outputValueB = 0n,
    nullifier1 = randomBytes(32),
    nullifier2 = randomBytes(32),
  } = {}) => {
    const assetId = bridgeCallData.inputAssetIdA;
    const notes = [
      createNote(assetId, outputValueA, owner.accountPublicKey, accountRequired, nullifier1, false),
      createNote(assetId, outputValueB, owner.accountPublicKey, accountRequired, nullifier2, false),
    ];
    const proofData = new InnerProofData(
      ProofId.DEFI_CLAIM,
      notes[0].note.commitment,
      notes[1].note.commitment,
      nullifier1,
      nullifier2,
      Buffer.alloc(32),
      Buffer.alloc(32),
      Buffer.alloc(32),
    );
    const offchainTxData = new OffchainDefiClaimData();
    return { proofData, offchainTxData };
  };

  const generateRollup = (
    rollupId = 0,
    innerProofs: InnerProofData[] = [],
    rollupSize = innerProofs.length,
    bridgeCallDatas: BridgeCallData[] = [],
    dataStartIndex = 0,
  ) => {
    const innerProofData = [...innerProofs];
    for (let i = innerProofs.length; i < rollupSize; ++i) {
      innerProofData.push(InnerProofData.PADDING);
    }
    return RollupProofData.randomData(rollupId, rollupSize, dataStartIndex, innerProofData, bridgeCallDatas);
  };

  const createBlock = (
    rollupProofData: RollupProofData,
    offchainTxData: Buffer[],
    interactionResult: DefiInteractionEvent[] = [],
  ): Block =>
    new Block(
      TxHash.random(),
      new Date(),
      rollupProofData.rollupId,
      1,
      rollupProofData.encode(),
      offchainTxData,
      interactionResult,
      0,
      0n,
    );

  const createRollupBlock = (
    innerProofs: { proofData: InnerProofData; offchainTxData: { toBuffer(): Buffer } }[] = [],
    {
      rollupId = 0,
      dataStartIndex = 0,
      rollupSize = innerProofs.length,
      interactionResult = [] as DefiInteractionEvent[],
      bridgeCallDatas = [] as BridgeCallData[],
    } = {},
  ) => {
    const rollup = generateRollup(
      rollupId,
      innerProofs.map(p => p.proofData),
      rollupSize,
      bridgeCallDatas,
      dataStartIndex,
    );
    const offchainTxData = innerProofs.map(p => p.offchainTxData.toBuffer());
    return createBlock(rollup, offchainTxData, interactionResult);
  };

  it('settle existing join split tx, add new note to db and nullify old note', async () => {
    const jsProof = generateTransferProof();
    const block = createRollupBlock([jsProof]);

    db.getPaymentTx.mockResolvedValue({ settled: undefined } as CorePaymentTx);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment2,
      value: jsProof.tx.senderPrivateOutput,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(2);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof.proofData.nullifier2);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.accountPublicKey,
        txId: new TxId(jsProof.proofData.txId),
        settled: block.mined,
      }),
    );
    expect(db.updateUser).toHaveBeenLastCalledWith({
      ...user,
      syncedToRollup: block.rollupId,
    });
  });

  it('add proof with pending notes, update the note status after settling the tx', async () => {
    const jsProof = generateTransferProof();
    const block = createRollupBlock([jsProof]);

    const tx = { proofId: ProofId.SEND } as CorePaymentTx;
    const clientProofData = Buffer.concat([
      jsProof.proofData.toBuffer(),
      Buffer.alloc(32 * 7), // noteTreeRoot ... backwardLink
      Buffer.concat([Buffer.alloc(31), Buffer.from([2])]), // allowChain = 2
    ]);
    const proofOutput = {
      tx,
      proofData: new ProofData(clientProofData),
      offchainTxData: jsProof.offchainTxData,
      outputNotes: jsProof.outputNotes,
    };
    await userState.addProof(proofOutput);
    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment2,
      value: jsProof.tx.senderPrivateOutput,
      allowChain: true,
      pending: true,
      hashPath: undefined,
    });
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx).toHaveBeenCalledWith(tx);
    db.addNote.mockClear();
    db.upsertPaymentTx.mockClear();

    db.getPaymentTx.mockResolvedValue({ settled: undefined } as CorePaymentTx);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment2,
      value: jsProof.tx.senderPrivateOutput,
      allowChain: false,
      pending: false,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.accountPublicKey,
        txId: new TxId(jsProof.proofData.txId),
        settled: block.mined,
      }),
    );
  });

  it('should correctly process multiple blocks', async () => {
    const jsProof1 = generateTransferProof({
      inputNoteValue1: 3n,
      inputNoteValue2: 4n,
      outputNoteValue1: 1n,
      outputNoteValue2: 2n,
    });
    const block1 = createRollupBlock([jsProof1], { rollupId: 0, rollupSize: 2, dataStartIndex: 0 });

    const accountProof = generateAccountProof();
    const jsProof2 = generateTransferProof({
      inputNoteValue1: 30n,
      inputNoteValue2: 40n,
      outputNoteValue1: 10n,
      outputNoteValue2: 20n,
    });
    const block2 = createRollupBlock([accountProof, jsProof2], { rollupId: 1, rollupSize: 2, dataStartIndex: 4 });

    db.getPaymentTx.mockResolvedValue({ settled: undefined } as CorePaymentTx);

    await userState.processBlocks([block1, block2].map(x => createBlockContext(x)));
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(2);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof1.proofData.noteCommitment2,
      value: 2n,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.addNote.mock.calls[1][0]).toMatchObject({
      commitment: jsProof2.proofData.noteCommitment2,
      value: 20n,
      hashPath: generatedHashPaths[7].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(4);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof1.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof1.proofData.nullifier2);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof2.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof2.proofData.nullifier1);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(2);
    expect(db.upsertPaymentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.accountPublicKey,
        txId: new TxId(jsProof1.proofData.txId),
        settled: block1.mined,
      }),
    );
    expect(db.upsertPaymentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.accountPublicKey,
        txId: new TxId(jsProof2.proofData.txId),
        settled: block2.mined,
      }),
    );
    expect(db.updateUser).toHaveBeenCalledTimes(1);
    expect(db.updateUser).toHaveBeenLastCalledWith({
      ...user,
      syncedToRollup: block2.rollupId,
    });
  });

  it('should correctly update syncedToRollup', async () => {
    const initialUser = userState.getUserData();
    expect(initialUser.syncedToRollup).toBe(-1);

    const blocks = Array(5)
      .fill(0)
      .map((_, i) => createRollupBlock([generatePaymentProof()], { rollupId: i }));
    await userState.processBlocks(blocks.map(x => createBlockContext(x)));
    await userState.flush();

    const user = userState.getUserData();
    expect(user.syncedToRollup).toBe(4);
    expect(user).not.toBe(initialUser);

    const paddingBlocks = Array(3)
      .fill(0)
      .map((_, i) => createRollupBlock([], { rollupId: 5 + i, rollupSize: 1 }));
    await userState.processBlocks(paddingBlocks.map(x => createBlockContext(x)));
    await userState.shutdown(true);

    expect(userState.getUserData().syncedToRollup).toBe(7);
  });

  it('do nothing if it cannot decrypt new notes', async () => {
    const stranger = createUser();
    const block = createRollupBlock([generatePaymentProof({ proofSender: stranger, newNoteOwner: stranger })]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(0);
    expect(db.nullifyNote).toHaveBeenCalledTimes(0);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(0);
  });

  it('restore a deposit tx and save to db', async () => {
    const depositValue = 100n;
    const txFee = 8n;
    const ethAddress = EthAddress.random();

    const jsProof = generateDepositProof({
      depositValue,
      txFee,
      ethAddress,
    });
    const block = createRollupBlock([jsProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    const txId = new TxId(jsProof.proofData.txId);
    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment1,
      value: depositValue,
      hashPath: generatedHashPaths[0].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(0);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      txId,
      userId: user.accountPublicKey,
      publicValue: depositValue + txFee,
      publicOwner: ethAddress,
      privateInput: 0n,
      recipientPrivateOutput: depositValue,
      senderPrivateOutput: 0n,
      isRecipient: true,
      settled: block.mined,
    });
  });

  it('restore a withdraw tx and save to db', async () => {
    const inputNoteValue1 = 70n;
    const inputNoteValue2 = 40n;
    const withdrawValue = 100n;
    const txFee = 8n;
    const recipient = EthAddress.random();

    const jsProof = generateWithdrawProof({
      inputNoteValue1,
      inputNoteValue2,
      withdrawValue,
      txFee,
      recipient,
    });
    const block = createRollupBlock([jsProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    const txId = new TxId(jsProof.proofData.txId);
    const changeValue = inputNoteValue1 + inputNoteValue2 - withdrawValue - txFee;
    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment2,
      value: changeValue,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(2);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof.proofData.nullifier2);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      txId,
      userId: user.accountPublicKey,
      publicValue: withdrawValue + txFee,
      publicOwner: recipient,
      privateInput: inputNoteValue1 + inputNoteValue2,
      recipientPrivateOutput: 0n,
      senderPrivateOutput: changeValue,
      isSender: true,
      settled: block.mined,
    });
  });

  it('restore a transfer tx sent from another user to us', async () => {
    const proofSender = createUser();
    const proof = generateTransferProof({
      proofSender,
      newNoteOwner: user,
    });
    const block = createRollupBlock([proof]);

    db.getNoteByNullifier.mockResolvedValue(undefined);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: proof.proofData.noteCommitment1,
      value: proof.tx.recipientPrivateOutput,
      hashPath: generatedHashPaths[0].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(0);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      userId: user.accountPublicKey,
      privateInput: 0n,
      recipientPrivateOutput: proof.tx.recipientPrivateOutput,
      senderPrivateOutput: 0n,
      isSender: false,
      isRecipient: true,
      settled: block.mined,
    });
  });

  it('restore a transfer tx sent from another local user to us', async () => {
    const proofSender = createUser();
    const proof = generateTransferProof({
      proofSender,
      newNoteOwner: user,
    });
    const block = createRollupBlock([proof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: proof.proofData.noteCommitment1,
      value: proof.tx.recipientPrivateOutput,
      hashPath: generatedHashPaths[0].toBuffer(),
    });

    // Will not nullify the notes even when they are in db.
    expect(db.getNoteByNullifier(proof.proofData.nullifier1)).not.toBeUndefined();
    expect(db.getNoteByNullifier(proof.proofData.nullifier2)).not.toBeUndefined();
    expect(db.nullifyNote).toHaveBeenCalledTimes(0);

    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      userId: user.accountPublicKey,
      privateInput: 0n,
      recipientPrivateOutput: proof.tx.recipientPrivateOutput,
      senderPrivateOutput: 0n,
      isSender: false,
      isRecipient: true,
      settled: block.mined,
    });
  });

  it('restore a transfer tx sent to another user', async () => {
    const proof = generateTransferProof();
    const block = createRollupBlock([proof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: proof.proofData.noteCommitment2,
      value: proof.tx.senderPrivateOutput,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(2);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(1);
    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      userId: user.accountPublicKey,
      recipientPrivateOutput: 0n,
      senderPrivateOutput: proof.tx.senderPrivateOutput,
      isSender: true,
      isRecipient: false,
      settled: block.mined,
    });
  });

  it('restore a transfer tx sent from unregistered to registered account', async () => {
    const proof = generateTransferProof({
      proofSender: user,
      proofSenderAccountRequired: false,
      newNoteOwner: user,
      newNoteOwnerAccountRequired: true,
    });
    const block = createRollupBlock([proof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      userId: user.accountPublicKey,
      isRecipient: true,
      isSender: true,
    });
  });

  it('restore a transfer tx sent from registered to unregistered account', async () => {
    const proof = generateTransferProof({
      proofSender: user,
      proofSenderAccountRequired: true,
      newNoteOwner: user,
      newNoteOwnerAccountRequired: false,
    });
    const block = createRollupBlock([proof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      userId: user.accountPublicKey,
      isRecipient: true,
      isSender: true,
    });
  });

  it('restore a transfer tx sent to unregistered account from someone else', async () => {
    const proofSender = createUser();
    const proof = generateTransferProof({
      proofSender,
      newNoteOwner: user,
      newNoteOwnerAccountRequired: false,
    });
    const block = createRollupBlock([proof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.upsertPaymentTx.mock.calls[0][0]).toMatchObject({
      userId: user.accountPublicKey,
      isRecipient: true,
      isSender: false,
    });
  });

  it('should settle account tx and add spending keys for user', async () => {
    const newSpendingPublicKey1 = GrumpkinAddress.random();
    const newSpendingPublicKey2 = GrumpkinAddress.random();
    const accountProof = generateAccountProof({ newSpendingPublicKey1, newSpendingPublicKey2 });
    const block = createRollupBlock([accountProof]);

    db.getAccountTx.mockResolvedValue({
      settled: undefined,
    } as CoreAccountTx);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    const txId = new TxId(accountProof.proofData.txId);

    expect(db.addSpendingKey).toHaveBeenCalledTimes(2);
    expect(db.addSpendingKey.mock.calls[0][0]).toEqual({
      userId: user.accountPublicKey,
      key: newSpendingPublicKey1.x(),
      treeIndex: 0,
      hashPath: generatedHashPaths[0].toBuffer(),
    });
    expect(db.addSpendingKey.mock.calls[1][0]).toEqual({
      userId: user.accountPublicKey,
      key: newSpendingPublicKey2.x(),
      treeIndex: 1,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.upsertAccountTx).toHaveBeenCalledTimes(1);
    expect(db.upsertAccountTx).toHaveBeenCalledWith(expect.objectContaining({ txId, settled: block.mined }));
  });

  it('should recover an account creation tx and add spending keys for user', async () => {
    const aliasHash = AliasHash.random();
    const newSpendingPublicKey1 = GrumpkinAddress.random();
    const newSpendingPublicKey2 = GrumpkinAddress.random();
    const accountProof = generateAccountProof({ aliasHash, newSpendingPublicKey1, newSpendingPublicKey2 });
    const block = createRollupBlock([accountProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    const txId = new TxId(accountProof.proofData.txId);

    expect(db.addSpendingKey).toHaveBeenCalledTimes(2);
    expect(db.addSpendingKey.mock.calls[0][0]).toEqual({
      userId: user.accountPublicKey,
      key: newSpendingPublicKey1.x(),
      treeIndex: 0,
      hashPath: generatedHashPaths[0].toBuffer(),
    });
    expect(db.addSpendingKey.mock.calls[1][0]).toEqual({
      userId: user.accountPublicKey,
      key: newSpendingPublicKey2.x(),
      treeIndex: 1,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.upsertAccountTx).toHaveBeenCalledTimes(1);
    expect(db.upsertAccountTx.mock.calls[0][0]).toMatchObject({
      txId,
      userId: user.accountPublicKey,
      aliasHash,
      newSpendingPublicKey1: newSpendingPublicKey1.x(),
      newSpendingPublicKey2: newSpendingPublicKey2.x(),
      migrated: false,
      settled: block.mined,
    });
  });

  it('should ignore an account migration tx created by current user', async () => {
    const newUser = createUser();
    const aliasHash = AliasHash.random();
    const newSpendingPublicKey1 = GrumpkinAddress.random();
    const newSpendingPublicKey2 = GrumpkinAddress.random();
    const accountProof = generateAccountProof({
      aliasHash,
      newAccountPublicKey: newUser.accountPublicKey,
      newSpendingPublicKey1,
      newSpendingPublicKey2,
    });
    const block = createRollupBlock([accountProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addSpendingKey).toHaveBeenCalledTimes(0);
    expect(db.upsertAccountTx).toHaveBeenCalledTimes(0);
  });

  it('should recover an account migration tx and add spending keys for the new user', async () => {
    const oldUser = createUser();
    const aliasHash = AliasHash.random();
    const newSpendingPublicKey1 = GrumpkinAddress.random();
    const newSpendingPublicKey2 = GrumpkinAddress.random();
    const accountProof = generateAccountProof({
      userId: oldUser.accountPublicKey,
      aliasHash,
      newAccountPublicKey: user.accountPublicKey,
      newSpendingPublicKey1,
      newSpendingPublicKey2,
    });
    const block = createRollupBlock([accountProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    const txId = new TxId(accountProof.proofData.txId);

    expect(db.addSpendingKey).toHaveBeenCalledTimes(2);
    expect(db.addSpendingKey.mock.calls[0][0]).toEqual({
      userId: user.accountPublicKey,
      key: newSpendingPublicKey1.x(),
      treeIndex: 0,
      hashPath: generatedHashPaths[0].toBuffer(),
    });
    expect(db.addSpendingKey.mock.calls[1][0]).toEqual({
      userId: user.accountPublicKey,
      key: newSpendingPublicKey2.x(),
      treeIndex: 1,
      hashPath: generatedHashPaths[1].toBuffer(),
    });
    expect(db.upsertAccountTx).toHaveBeenCalledTimes(1);
    expect(db.upsertAccountTx.mock.calls[0][0]).toMatchObject({
      txId,
      userId: user.accountPublicKey,
      aliasHash,
      newSpendingPublicKey1: newSpendingPublicKey1.x(),
      newSpendingPublicKey2: newSpendingPublicKey2.x(),
      migrated: true,
      settled: block.mined,
    });
  });

  it('should ignore account proof that is not us', async () => {
    const randomUser = createUser();
    const accountProof = generateAccountProof({ userId: randomUser.accountPublicKey });
    const block = createRollupBlock([accountProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addSpendingKey).toHaveBeenCalledTimes(0);
    expect(db.upsertAccountTx).toHaveBeenCalledTimes(0);
  });

  it('update a defi tx and nullify old notes', async () => {
    const outputNoteValue = 36n;
    const bridgeCallData = BridgeCallData.random();
    const depositValue = 64n;
    const totalInputValue = depositValue * 5n;
    const totalOutputValueA = depositValue;
    const totalOutputValueB = depositValue * 10n;
    const outputValueA = depositValue / 5n;
    const outputValueB = totalOutputValueB / 5n;
    const success = true;

    const defiProof = generateDefiDepositProof({ bridgeCallData, outputNoteValue, depositValue });
    const interactionNonce = 0;
    const interactionResult = [
      new DefiInteractionEvent(
        bridgeCallData,
        interactionNonce,
        totalInputValue,
        totalOutputValueA,
        totalOutputValueB,
        success,
      ),
      new DefiInteractionEvent(BridgeCallData.random(), interactionNonce + 1, 12n, 34n, 56n, success),
    ];
    const block = createRollupBlock([defiProof], {
      interactionResult,
      bridgeCallDatas: interactionResult.map(ir => ir.bridgeCallData),
      dataStartIndex: 256,
    });
    const txId = new TxId(defiProof.proofData.txId);

    db.getUnclaimedDefiTxs
      .mockResolvedValue([])
      .mockResolvedValueOnce([{ txId, depositValue: depositValue } as CoreDefiTx]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    const { partialState, partialStateSecretEphPubKey } = defiProof.offchainTxData;
    const partialStateSecret = deriveNoteSecret(partialStateSecretEphPubKey, user.accountPrivateKey, grumpkin);
    const nullifier = noteAlgos.claimNoteNullifier(defiProof.proofData.noteCommitment1);

    expect(db.addNote).toHaveBeenCalledTimes(1);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: defiProof.proofData.noteCommitment2,
      value: outputNoteValue,
      hashPath: generatedHashPaths[257].toBuffer(),
    });
    expect(db.nullifyNote).toHaveBeenCalledTimes(2);
    expect(db.nullifyNote).toHaveBeenCalledWith(defiProof.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(defiProof.proofData.nullifier2);
    expect(db.upsertDefiTx).toHaveBeenCalledTimes(1);
    expect(db.upsertDefiTx).toHaveBeenCalledWith(
      expect.objectContaining({
        txId,
        userId: user.accountPublicKey,
        interactionNonce,
        isAsync: false,
        settled: block.mined,
        success,
        outputValueA,
        outputValueB,
        partialState,
        partialStateSecret,
        nullifier,
      }),
    );
  });

  it('update a defi tx and nullify old notes - async defi', async () => {
    const outputNoteValue = 36n;
    const bridgeCallData = BridgeCallData.random();
    const depositValue = 64n;
    const totalInputValue = depositValue * 5n;
    const totalOutputValueA = depositValue;
    const totalOutputValueB = depositValue * 10n;
    const outputValueA = depositValue / 5n;
    const outputValueB = totalOutputValueB / 5n;
    const result = true;

    const defiProof = generateDefiDepositProof({ bridgeCallData, outputNoteValue, depositValue });
    const interactionNonce = 0;

    // first rollup doesn't have defi result
    const block1 = createRollupBlock([defiProof], {
      bridgeCallDatas: [bridgeCallData, BridgeCallData.random(), BridgeCallData.random()],
      interactionResult: [
        new DefiInteractionEvent(BridgeCallData.random(), interactionNonce + 1, 12n, 34n, 56n, result),
      ],
      dataStartIndex: 256,
    });
    const txId = new TxId(defiProof.proofData.txId);

    // create some other transaction to put into a rollup
    // the defi interaction result will go in this block
    const jsProof = generateTransferProof();
    const block2 = createRollupBlock([jsProof], {
      rollupId: 1,
      interactionResult: [
        new DefiInteractionEvent(
          bridgeCallData,
          interactionNonce,
          totalInputValue,
          totalOutputValueA,
          totalOutputValueB,
          result,
        ),
      ],
      dataStartIndex: 258,
    });

    db.getUnclaimedDefiTxs
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => Promise.resolve([db.upsertDefiTx.mock.calls[0][0]]));

    await userState.processBlocks([createBlockContext(block1)]);
    await userState.flush();

    // defi tx should have been given nonce
    expect(db.upsertDefiTx).toHaveBeenCalledTimes(1);
    expect(db.upsertDefiTx).toHaveBeenCalledWith(
      expect.objectContaining({
        txId,
        settled: block1.mined,
        interactionNonce: 0,
        isAsync: true,
        success: undefined,
        outputValueA: undefined,
        outputValueB: undefined,
        finalised: undefined,
      }),
    );

    await userState.processBlocks([createBlockContext(block2)]);
    await userState.shutdown(true);

    // defi inputs should have been nullified
    expect(db.nullifyNote).toHaveBeenCalledTimes(4);
    expect(db.nullifyNote).toHaveBeenCalledWith(defiProof.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(defiProof.proofData.nullifier2);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof.proofData.nullifier1);
    expect(db.nullifyNote).toHaveBeenCalledWith(jsProof.proofData.nullifier2);

    expect(db.upsertDefiTx).toHaveBeenCalledTimes(2);
    expect(db.upsertDefiTx).toHaveBeenCalledWith(
      expect.objectContaining({
        txId,
        settled: block1.mined,
        interactionNonce,
        isAsync: true,
        success: true,
        outputValueA,
        outputValueB,
        finalised: block2.mined,
      }),
    );
  });

  it('add defi proof and its linked j/s proof, update the note status after the tx is settled', async () => {
    const jsTxFee = 2n;
    const outputNoteValue1 = 36n;
    const outputNoteValue2 = 64n;
    const defiTxFee = 6n;
    const depositValue = outputNoteValue1 - defiTxFee;
    const outputValueA = 10n;
    const outputValueB = 20n;
    const bridgeCallData = BridgeCallData.random();
    const defiResult = true;

    const jsProof = generatePaymentProof({ newNoteOwner: user, outputNoteValue1, outputNoteValue2, txFee: jsTxFee });
    const jsProofData = Buffer.concat([
      jsProof.proofData.toBuffer(),
      Buffer.alloc(32 * 7), // noteTreeRoot ... backwardLink
      Buffer.concat([Buffer.alloc(31), Buffer.from([3])]), // allowChain = 3
    ]);
    const jsProofOutput = {
      tx: jsProof.tx,
      outputNotes: jsProof.outputNotes,
      proofData: new ProofData(jsProofData),
      offchainTxData: jsProof.offchainTxData,
    };

    const defiProof = generateDefiDepositProof({ bridgeCallData, depositValue });
    const defiProofData = Buffer.concat([
      defiProof.proofData.toBuffer(),
      Buffer.alloc(32 * 7), // noteTreeRoot ... backwardLink
      Buffer.alloc(32), // allowChain = 0
    ]);

    const defiProofOutput = {
      tx: defiProof.tx,
      outputNotes: defiProof.outputNotes,
      proofData: new ProofData(defiProofData),
      offchainTxData: defiProof.offchainTxData,
      jsProofOutput,
    };

    await userState.addProof(defiProofOutput);
    expect(db.addNote).toHaveBeenCalledTimes(0);
    expect(db.upsertPaymentTx).toHaveBeenCalledTimes(0);
    expect(db.upsertDefiTx).toHaveBeenCalledTimes(1);
    expect(db.upsertDefiTx).toHaveBeenCalledWith(defiProof.tx);

    db.addNote.mockClear();
    db.upsertDefiTx.mockClear();

    const defiProofInteractionNonce = 0;
    const interactionResult = [
      new DefiInteractionEvent(
        bridgeCallData,
        defiProofInteractionNonce,
        depositValue,
        outputValueA,
        outputValueB,
        defiResult,
      ),
    ];
    const block = createRollupBlock([jsProof, defiProof], {
      interactionResult,
      bridgeCallDatas: [bridgeCallData],
      dataStartIndex: 92,
    });
    db.getUnclaimedDefiTxs
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => Promise.resolve([db.upsertDefiTx.mock.calls[0][0]]));

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(2);
    expect(db.addNote.mock.calls[0][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment1,
      value: outputNoteValue1,
      allowChain: false,
      pending: false,
      hashPath: generatedHashPaths[92].toBuffer(),
    });
    expect(db.addNote.mock.calls[1][0]).toMatchObject({
      commitment: jsProof.proofData.noteCommitment2,
      value: outputNoteValue2,
      allowChain: false,
      pending: false,
      hashPath: generatedHashPaths[93].toBuffer(),
    });
  });

  it('should not add notes with incorrect commitments', async () => {
    const outputNoteValue1 = 36n;
    const outputNoteValue2 = 64n;

    const jsProof = generatePaymentProof({
      outputNoteValue1,
      outputNoteValue2,
      createValidNoteCommitments: false,
    });
    const block = createRollupBlock([jsProof]);

    await userState.processBlocks([createBlockContext(block)]);
    await userState.shutdown(true);

    expect(db.addNote).toHaveBeenCalledTimes(0);
  });

  it('remove orphaned txs and notes', async () => {
    const unsettledUserTxs = [...Array(4)].map(() => ({ txId: TxId.random() } as CoreUserTx));
    db.getPendingUserTxs.mockResolvedValue(unsettledUserTxs);

    const pendingNotes = [...Array(6)].map(() => ({ commitment: randomBytes(32), nullifier: randomBytes(32) }));
    db.getPendingNotes.mockResolvedValue(pendingNotes as Note[]);

    const pendingTxs = [
      { txId: TxId.random(), noteCommitment1: pendingNotes[1].commitment, noteCommitment2: randomBytes(32) },
      { txId: unsettledUserTxs[1].txId, noteCommitment1: randomBytes(32), noteCommitment2: pendingNotes[2].commitment },
      { txId: TxId.random(), noteCommitment1: randomBytes(32), noteCommitment2: randomBytes(32) },
      {
        txId: unsettledUserTxs[3].txId,
        noteCommitment1: pendingNotes[4].commitment,
        noteCommitment2: pendingNotes[5].commitment,
      },
    ];
    rollupProvider.getPendingTxs.mockResolvedValue(pendingTxs);

    userState = new UserState(user, grumpkin, noteAlgos, noteDecryptor, db as any, rollupProvider as any);
    await userState.init();

    expect(db.removeUserTx).toHaveBeenCalledTimes(2);
    expect(db.removeUserTx).toHaveBeenCalledWith(user.accountPublicKey, unsettledUserTxs[0].txId);
    expect(db.removeUserTx).toHaveBeenCalledWith(user.accountPublicKey, unsettledUserTxs[2].txId);
    expect(db.removeNote).toHaveBeenCalledTimes(2);
    expect(db.removeNote).toHaveBeenCalledWith(pendingNotes[0].nullifier);
    expect(db.removeNote).toHaveBeenCalledWith(pendingNotes[3].nullifier);
  });

  describe('defi claim proof', () => {
    const depositValue = 12n;
    const txId = TxId.random();
    const secret = randomBytes(32);
    const nullifier1 = randomBytes(32);
    const nullifier2 = randomBytes(32);
    const interactionNonce = 789;

    let outputAssetIdA: number;
    let outputAssetIdB: number;
    let bridgeCallData: BridgeCallData;
    let outputValueA: bigint;
    let outputValueB: bigint;
    let accountRequired: boolean;
    let partialState: Buffer;
    let success: boolean;

    beforeEach(() => {
      outputAssetIdA = 3;
      outputAssetIdB = 4;
      bridgeCallData = new BridgeCallData(0, 1, outputAssetIdA, 2, outputAssetIdB);
      outputValueA = 34n;
      outputValueB = 56n;
      accountRequired = true;
      success = true;
    });

    const setupTest = async () => {
      partialState = noteAlgos.valueNotePartialCommitment(secret, user.accountPublicKey, accountRequired);
      const claimGenData = { bridgeCallData, outputValueA, outputValueB, nullifier1, nullifier2 };
      const claimProof = generateDefiClaimProof(claimGenData);
      const block = createRollupBlock([claimProof]);
      const defiTx = {
        txId,
        userId: user.accountPublicKey,
        partialStateSecret: secret,
        partialState,
        nullifier: nullifier1,
        bridgeCallData,
        depositValue,
        outputValueA,
        outputValueB,
        success,
        interactionNonce,
      } as CoreDefiTx;

      db.getUnclaimedDefiTxs.mockImplementation(() => Promise.resolve([defiTx]));

      await userState.processBlocks([createBlockContext(block)]);
      await userState.shutdown(true);

      return {
        claimGenData,
        claimProof,
        defiTx,
        block,
      };
    };

    it('settle a defi tx and add new notes', async () => {
      const { claimGenData, claimProof, defiTx, block } = await setupTest();

      expect(db.addNote).toHaveBeenCalledTimes(2);
      expect(db.addNote.mock.calls[0][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment1,
        treeNote: expect.objectContaining({
          assetId: defiTx.bridgeCallData.outputAssetIdA,
          value: claimGenData.outputValueA,
          noteSecret: defiTx.partialStateSecret,
          accountRequired: true,
        }),
      });
      expect(db.addNote.mock.calls[1][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment2,
        treeNote: expect.objectContaining({
          assetId: defiTx.bridgeCallData.outputAssetIdB,
          value: claimGenData.outputValueB,
          noteSecret: defiTx.partialStateSecret,
          accountRequired: true,
        }),
      });

      expect(db.upsertDefiTx).toHaveBeenCalledWith(
        expect.objectContaining({
          claimTxId: new TxId(claimProof.proofData.txId),
          claimSettled: block.mined,
        }),
      );
    });

    it('settle a defi tx and add new notes for unregistered account', async () => {
      accountRequired = false;

      const { claimProof } = await setupTest();

      expect(db.addNote).toHaveBeenCalledTimes(2);
      expect(db.addNote.mock.calls[0][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment1,
        treeNote: expect.objectContaining({
          assetId: outputAssetIdA,
          value: outputValueA,
          noteSecret: secret,
          accountRequired,
        }),
      });
      expect(db.addNote.mock.calls[1][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment2,
        treeNote: expect.objectContaining({
          assetId: outputAssetIdB,
          value: outputValueB,
          noteSecret: secret,
          accountRequired,
        }),
      });
    });

    it('settle a defi tx and add one virtual output note', async () => {
      outputAssetIdA = virtualAssetIdPlaceholder;
      bridgeCallData = new BridgeCallData(0, 1, outputAssetIdA);
      outputValueB = 0n;

      const { claimProof } = await setupTest();

      expect(db.addNote).toHaveBeenCalledTimes(1);
      expect(db.addNote.mock.calls[0][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment1,
        treeNote: expect.objectContaining({
          assetId: virtualAssetIdFlag + interactionNonce,
          value: outputValueA,
          noteSecret: secret,
          accountRequired,
        }),
      });
    });

    it('settle a defi tx and add one real and one virtual output notes', async () => {
      outputAssetIdB = virtualAssetIdPlaceholder;
      bridgeCallData = new BridgeCallData(0, 1, outputAssetIdA, 2, outputAssetIdB);

      const { claimProof } = await setupTest();

      expect(db.addNote).toHaveBeenCalledTimes(2);
      expect(db.addNote.mock.calls[0][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment1,
        treeNote: expect.objectContaining({
          assetId: outputAssetIdA,
          value: outputValueA,
          noteSecret: secret,
          accountRequired,
        }),
      });
      expect(db.addNote.mock.calls[1][0]).toMatchObject({
        commitment: claimProof.proofData.noteCommitment2,
        treeNote: expect.objectContaining({
          assetId: virtualAssetIdFlag + interactionNonce,
          value: outputValueB,
          noteSecret: secret,
          accountRequired,
        }),
      });
    });

    describe('refunds', () => {
      const inputAssetIdA = 1;
      const inputAssetIdB = 2;

      beforeEach(() => {
        bridgeCallData = new BridgeCallData(0, inputAssetIdA, 2);
        outputValueA = 0n;
        outputValueB = 0n;
        success = false;
      });

      it('settle a failed defi tx and add a refund note', async () => {
        const { claimProof } = await setupTest();

        expect(db.addNote).toHaveBeenCalledTimes(1);
        expect(db.addNote.mock.calls[0][0]).toMatchObject({
          commitment: claimProof.proofData.noteCommitment1,
          treeNote: expect.objectContaining({
            assetId: inputAssetIdA,
            value: depositValue,
            noteSecret: secret,
            accountRequired,
          }),
        });
      });

      it('settle a failed defi tx and add a refund note for unregistered account', async () => {
        accountRequired = false;

        const { claimProof } = await setupTest();

        expect(db.addNote).toHaveBeenCalledTimes(1);
        expect(db.addNote.mock.calls[0][0]).toMatchObject({
          commitment: claimProof.proofData.noteCommitment1,
          treeNote: expect.objectContaining({
            assetId: inputAssetIdA,
            value: depositValue,
            noteSecret: secret,
            accountRequired,
          }),
        });
      });

      it('settle a failed defi tx and add two refund notes', async () => {
        bridgeCallData = new BridgeCallData(0, inputAssetIdA, 0, inputAssetIdB);

        const { claimProof } = await setupTest();

        expect(db.addNote).toHaveBeenCalledTimes(2);
        expect(db.addNote.mock.calls[0][0]).toMatchObject({
          commitment: claimProof.proofData.noteCommitment1,
          treeNote: expect.objectContaining({
            assetId: inputAssetIdA,
            value: depositValue,
            noteSecret: secret,
            accountRequired,
          }),
        });
        expect(db.addNote.mock.calls[1][0]).toMatchObject({
          commitment: claimProof.proofData.noteCommitment2,
          treeNote: expect.objectContaining({
            assetId: inputAssetIdB,
            value: depositValue,
            noteSecret: secret,
            accountRequired,
          }),
        });
      });
    });
  });
});
