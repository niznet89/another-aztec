import { AliasHash } from '@aztec/barretenberg/account_id';
import { GrumpkinAddress } from '@aztec/barretenberg/address';
import { toBufferBE } from '@aztec/barretenberg/bigint_buffer';
import { TxHash, TxType } from '@aztec/barretenberg/blockchain';
import { createDebugLogger } from '@aztec/barretenberg/log';
import { DefiInteractionNote } from '@aztec/barretenberg/note_algorithms';
import { RollupProofData } from '@aztec/barretenberg/rollup_proof';
import { serializeBufferArrayToVector } from '@aztec/barretenberg/serialize';
import { WorldStateConstants } from '@aztec/barretenberg/world_state';
import { DataSource, In, IsNull, LessThan, MoreThanOrEqual, Not, Repository } from 'typeorm';
import {
  AccountDao,
  AssetMetricsDao,
  ClaimDao,
  RollupDao,
  RollupProofDao,
  TxDao,
  BridgeMetricsDao,
} from '../entity/index.js';
import { getNewAccountDaos } from './tx_dao_to_account_dao.js';

export type RollupDb = {
  [P in keyof TypeOrmRollupDb]: TypeOrmRollupDb[P];
};

function nullToUndefined<T>(input: T | null) {
  return input === null ? undefined : input;
}

export class TypeOrmRollupDb implements RollupDb {
  private txRep: Repository<TxDao>;
  private rollupProofRep: Repository<RollupProofDao>;
  private rollupRep: Repository<RollupDao>;
  private accountRep: Repository<AccountDao>;
  private claimRep: Repository<ClaimDao>;
  private assetMetricsRep: Repository<AssetMetricsDao>;
  private bridgeMetricsRep: Repository<BridgeMetricsDao>;
  private debug = createDebugLogger('bb:typeorm_rollup_db');

  constructor(private connection: DataSource, private initialDataRoot: Buffer = WorldStateConstants.EMPTY_DATA_ROOT) {
    this.txRep = this.connection.getRepository(TxDao);
    this.rollupProofRep = this.connection.getRepository(RollupProofDao);
    this.rollupRep = this.connection.getRepository(RollupDao);
    this.accountRep = this.connection.getRepository(AccountDao);
    this.claimRep = this.connection.getRepository(ClaimDao);
    this.assetMetricsRep = this.connection.getRepository(AssetMetricsDao);
    this.bridgeMetricsRep = this.connection.getRepository(BridgeMetricsDao);
  }

  public init() {
    return Promise.resolve();
  }

  public async destroy() {
    await this.connection.destroy();
  }

  public async addTx(txDao: TxDao) {
    await this.connection.transaction(async transactionalEntityManager => {
      await transactionalEntityManager.save(txDao);
      const [newAccountDao] = getNewAccountDaos([txDao]);
      if (newAccountDao) {
        await transactionalEntityManager.save(newAccountDao);
      }
    });
  }

  public async addTxs(txs: TxDao[]) {
    await this.connection.transaction(async transactionalEntityManager => {
      const accountDaos = getNewAccountDaos(txs);
      await transactionalEntityManager.save(accountDaos);
      await transactionalEntityManager.save(txs);
    });
  }

  public async deleteTxsById(ids: Buffer[]) {
    await this.txRep.delete({ id: In(ids) });
  }

  public async addAccounts(accounts: AccountDao[]) {
    await this.connection.transaction(async transactionalEntityManager => {
      for (const account of accounts) {
        await transactionalEntityManager.save(account);
      }
    });
  }

  public async getTx(txId: Buffer) {
    return nullToUndefined(
      await this.txRep.findOne({ where: { id: txId }, relations: ['rollupProof', 'rollupProof.rollup'] }),
    );
  }

  public async getPendingTxCount() {
    return await this.txRep.count({
      where: { rollupProof: IsNull(), secondClass: false },
    });
  }

  public async getPendingSecondClassTxCount() {
    return await this.txRep.count({
      where: { rollupProof: IsNull(), secondClass: true },
    });
  }

  public async deletePendingTxs() {
    await this.txRep.delete({ rollupProof: IsNull() });
  }

  public async getTotalTxCount() {
    return await this.txRep.count();
  }

  public async getJoinSplitTxCount() {
    return await this.txRep.count({ where: { txType: LessThan(TxType.ACCOUNT) } });
  }

  public async getDefiTxCount() {
    return await this.txRep.count({ where: { txType: TxType.DEFI_DEPOSIT } });
  }

  public async getAccountTxCount() {
    return await this.txRep.count({ where: { txType: TxType.ACCOUNT } });
  }

  public async getAccountCount() {
    return await this.accountRep.count();
  }

  public async isAccountRegistered(accountPublicKey: GrumpkinAddress) {
    const account = await this.accountRep.findOne({ where: { accountPublicKey: accountPublicKey.toBuffer() } });
    return !!account;
  }

  public async isAliasRegistered(aliasHash: AliasHash) {
    const account = await this.accountRep.findOne({ where: { aliasHash: aliasHash.toBuffer() } });
    return !!account;
  }

  public async isAliasRegisteredToAccount(accountPublicKey: GrumpkinAddress, aliasHash: AliasHash) {
    const account = await this.accountRep.findOne({
      where: { accountPublicKey: accountPublicKey.toBuffer(), aliasHash: aliasHash.toBuffer() },
    });
    return !!account;
  }

  public async getAccountRegistrationRollupId(accountPublicKey: GrumpkinAddress) {
    const account = await this.accountRep.findOne({
      where: { accountPublicKey: accountPublicKey.toBuffer() },
      relations: {
        tx: {
          rollupProof: {
            rollup: true,
          },
        },
      },
    });
    if (!account?.tx?.rollupProof?.rollup) {
      return null;
    }
    return account.tx.rollupProof.rollup.id;
  }

  public async getUnsettledTxCount() {
    return await this.txRep.count({ where: { mined: IsNull() } });
  }

  public async getUnsettledTxs() {
    return await this.txRep.find({ where: { mined: IsNull() } });
  }

  public async getUnsettledDepositTxs() {
    return await this.txRep.find({
      where: { txType: TxType.DEPOSIT, mined: IsNull() },
    });
  }

  public async getPendingTxs(take?: number) {
    return await this.txRep.find({
      where: { rollupProof: IsNull(), secondClass: false },
      order: { created: 'ASC' },
      take,
    });
  }

  public async getPendingSecondClassTxs(take?: number) {
    return await this.txRep.find({
      where: { rollupProof: IsNull(), secondClass: true },
      order: { created: 'ASC' },
      take,
    });
  }

  public async getUnsettledNullifiers() {
    const unsettledTxs = await this.txRep.find({
      select: { nullifier1: true, nullifier2: true },
      where: { mined: IsNull() },
    });
    return unsettledTxs
      .map(tx => [tx.nullifier1, tx.nullifier2])
      .flat()
      .filter((n): n is Buffer => !!n);
  }

  public async nullifiersExist(nullifiers: Buffer[]) {
    const count = await this.txRep.count({ where: [{ nullifier1: In(nullifiers) }, { nullifier2: In(nullifiers) }] });
    return count > 0;
  }

  public async addRollupProof(rollupDao: RollupProofDao) {
    await this.rollupProofRep.save(rollupDao);
  }

  public async addRollupProofs(rollupDaos: RollupProofDao[]) {
    for (const dao of rollupDaos) {
      await this.rollupProofRep.save(dao);
    }
  }

  public async getRollupProof(id: Buffer, includeTxs = false) {
    return nullToUndefined(
      await this.rollupProofRep.findOne({ where: { id }, relations: includeTxs ? ['txs'] : undefined }),
    );
  }

  public async deleteRollupProof(id: Buffer) {
    await this.rollupProofRep.delete({ id });
  }

  /**
   * If a rollup proof is replaced by a larger aggregate, it will become "orphaned" from it's transactions.
   * This removes any rollup proofs that are no longer referenced by transactions.
   */
  public async deleteTxlessRollupProofs() {
    const orphaned = await this.rollupProofRep
      .createQueryBuilder('rollup_proof')
      .select('rollup_proof.id')
      .leftJoin('rollup_proof.txs', 'tx')
      .where('tx.rollupProof IS NULL')
      .getMany();
    await this.rollupProofRep.delete({ id: In(orphaned.map(rp => rp.id)) });
  }

  public async deleteOrphanedRollupProofs() {
    await this.rollupProofRep.delete({ rollup: IsNull() });
  }

  public async getNumSettledRollups() {
    return await this.rollupRep.count({
      where: { mined: Not(IsNull()) },
    });
  }

  public async getNextRollupId() {
    const latestRollup = await this.rollupRep.findOne({
      select: { id: true },
      where: { mined: Not(IsNull()) },
      order: { id: 'DESC' },
    });
    return latestRollup ? latestRollup.id + 1 : 0;
  }

  public async getRollup(id: number) {
    this.debug(`fetching rollup ${id}...`);
    const rollup = nullToUndefined(
      await this.rollupRep.findOne({
        where: { id },
        relations: ['rollupProof', 'assetMetrics', 'bridgeMetrics'],
      }),
    );
    if (!rollup) {
      return;
    }

    // Loading these as part of relations above leaks GB's of memory.
    // One would think the following would be much slower, but it's not actually that bad.
    this.debug(`populating txs for rollup ${id}...`);
    // Populate the txs in order by position
    rollup.rollupProof.txs = await this.txRep.find({
      where: { rollupProof: { id: rollup.rollupProof.id } },
      order: {
        position: 'ASC',
      },
    });
    return rollup;
  }

  public async getAssetMetrics(assetId: number) {
    return nullToUndefined(await this.assetMetricsRep.findOne({ where: { assetId }, order: { rollupId: 'DESC' } }));
  }

  public async getBridgeMetricsForRollup(bridgeCallData: bigint, rollupId: number) {
    // TODO: rename bridgeId to bridgeCallData
    return await this.bridgeMetricsRep.findOne({ where: { bridgeId: bridgeCallData, rollupId } });
  }

  public async getOurLastBridgeMetrics(bridgeCallData: bigint) {
    // TODO: rename bridgeId to bridgeCallData
    return await this.bridgeMetricsRep.findOne({
      where: { bridgeId: bridgeCallData, publishedByProvider: true },
      order: { rollupId: 'DESC' },
    });
  }

  public async addBridgeMetrics(bridgeMetrics: BridgeMetricsDao[]) {
    await this.connection.transaction(async transactionalEntityManager => {
      await transactionalEntityManager.save<BridgeMetricsDao>(bridgeMetrics);
    });
  }

  /**
   * Warning: rollups[i].rollupProof.txs must be ordered as they exist within the proof.
   * The rollupProof entity enforces this after load, but we're sidestepping it here due to join memory issues.
   * Do not populate the tx array manually, without enforcing this order.
   */
  public async getRollups(take?: number, skip?: number, descending = false) {
    const result = await this.rollupRep.find({
      order: { id: descending ? 'DESC' : 'ASC' },
      relations: ['rollupProof'],
      take,
      skip,
    });
    // Loading these as part of relations above leaks GB's of memory.
    // One would think the following would be much slower, but it's not actually that bad.
    for (const rollup of result) {
      // Populate the txs in order by position
      rollup.rollupProof.txs = await this.txRep.find({
        where: { rollupProof: { id: rollup.rollupProof.id } },
        order: {
          position: 'ASC',
        },
      });
    }
    return result;
  }

  /**
   * Does not return txs. They're not needed in calling context.
   */
  public async getSettledRollupsAfterTime(time: Date) {
    return await this.rollupRep.find({
      where: [{ mined: MoreThanOrEqual(time) }],
      order: { id: 'ASC' },
      relations: ['rollupProof'],
    });
  }

  /**
   * Warning: rollups[i].rollupProof.txs must be ordered as they exist within the proof.
   * The rollupProof entity enforces this after load, but we're sidestepping it here due to join memory issues.
   * Do not populate the tx array manually, without enforcing this order.
   */
  public async getSettledRollups(from: number, take: number) {
    this.debug(`getSettledRollups: fetching settled rollups...`);
    const rollups = await this.rollupRep.find({
      where: { id: MoreThanOrEqual(from), mined: Not(IsNull()) },
      order: { id: 'ASC' },
      relations: ['rollupProof'],
      take,
    });
    // Loading these as part of relations above leaks GB's of memory.
    // One would think the following would be much slower, but it's not actually that bad.
    for (const rollup of rollups) {
      this.debug(`getSettledRollups: fetching txs for settled rollup ${rollup.id}...`);
      // Populate the txs in order by position
      rollup.rollupProof.txs = await this.txRep.find({
        where: { rollupProof: { id: rollup.rollupProof.id } },
        order: {
          position: 'ASC',
        },
      });
    }
    return rollups;
  }

  public async getRollupsByRollupIds(ids: number[]) {
    return await this.rollupRep.find({
      where: { id: In(ids) },
    });
  }

  public async addRollup(rollup: RollupDao) {
    await this.connection.transaction(async transactionalEntityManager => {
      // We need to erase any existing rollup first, to ensure we don't get a unique violation when inserting a
      // different rollup proof which has a one to one mapping with the rollup.
      await transactionalEntityManager.delete(this.rollupRep.target, { id: rollup.id });
      await transactionalEntityManager.insert(this.rollupRep.target, rollup);

      // Add the rollup proof.
      rollup.rollupProof.rollup = rollup;
      await transactionalEntityManager.delete(this.rollupProofRep.target, { id: rollup.rollupProof.id });
      await transactionalEntityManager.insert(this.rollupProofRep.target, rollup.rollupProof);
      delete rollup.rollupProof.rollup;

      // To ensure the txs are correctly ordered, we order them as their ids are ordered in the proof data
      const decodedProofData = RollupProofData.decode(rollup.rollupProof.encodedProofData);

      for (const [i, proof] of decodedProofData.innerProofData.entries()) {
        if (!proof.isPadding()) {
          const tx = rollup.rollupProof.txs.find(tx => tx.id.equals(proof.txId));
          if (!tx) {
            throw new Error(`Could not find tx with id ${proof.txId} in rollup proof`);
          }
          tx.rollupProof = rollup.rollupProof;
          tx.position = i;
          await transactionalEntityManager.upsert(this.txRep.target, tx, {
            skipUpdateIfNoValuesChanged: true,
            conflictPaths: ['id'],
          });
          delete tx.rollupProof;
        }
      }

      const accountDaos = getNewAccountDaos(rollup.rollupProof.txs);
      await transactionalEntityManager.upsert(this.accountRep.target, accountDaos, ['accountPublicKey']);
    });
  }

  public async setCallData(id: number, processRollupCalldata: Buffer) {
    await this.rollupRep.update({ id }, { processRollupCalldata });
  }

  public async confirmSent(id: number, ethTxHash: TxHash) {
    await this.rollupRep.update({ id }, { ethTxHash } as Partial<RollupDao>);
  }

  public async confirmMined(
    id: number,
    gasUsed: number,
    gasPrice: bigint,
    mined: Date,
    ethTxHash: TxHash,
    interactionResult: DefiInteractionNote[],
    txIds: Buffer[],
    assetMetrics: AssetMetricsDao[],
    bridgeMetrics: BridgeMetricsDao[],
    subtreeRoot: Buffer,
  ) {
    await this.connection.transaction(async transactionalEntityManager => {
      await transactionalEntityManager.update<TxDao>(this.txRep.target, { id: In(txIds) }, { mined });
      const dao: Partial<RollupDao> = {
        mined,
        gasUsed,
        gasPrice: toBufferBE(gasPrice, 32),
        ethTxHash,
        interactionResult: serializeBufferArrayToVector(interactionResult.map(r => r.toBuffer())),
        subtreeRoot,
      };
      await transactionalEntityManager.update<RollupDao>(this.rollupRep.target, { id }, dao);
      await transactionalEntityManager.insert<AssetMetricsDao>(this.assetMetricsRep.target, assetMetrics);
      await transactionalEntityManager.save<BridgeMetricsDao>(bridgeMetrics);
    });
    return (await this.getRollup(id))!;
  }

  public async getLastSettledRollup() {
    return nullToUndefined(
      await this.rollupRep.findOne({
        where: { mined: Not(IsNull()) },
        order: { id: 'DESC' },
        relations: ['rollupProof'],
      }),
    );
  }

  public async getUnsettledRollups() {
    return await this.rollupRep.find({
      where: { mined: IsNull() },
      order: { id: 'ASC' },
    });
  }

  public async deleteUnsettledRollups() {
    await this.rollupRep.delete({ mined: IsNull() });
  }

  public async getRollupByDataRoot(dataRoot: Buffer) {
    return nullToUndefined(await this.rollupRep.findOne({ where: { dataRoot } }));
  }

  public async getDataRootsIndex(root: Buffer) {
    // Lookup and save the proofs data root index (for old root support).
    if (root.equals(this.initialDataRoot)) {
      return 0;
    }

    const rollup = await this.getRollupByDataRoot(root);
    if (!rollup) {
      throw new Error(`Rollup not found for merkle root: ${root.toString('hex')}`);
    }
    return rollup.id + 1;
  }

  public async addClaims(claims: ClaimDao[]) {
    await this.claimRep.save(claims);
  }

  public async getClaimsToRollup(take?: number) {
    return await this.claimRep.find({
      where: { claimed: IsNull(), interactionResultRollupId: Not(IsNull()) },
      order: { id: 'ASC' },
      take,
    });
  }

  public async updateClaimsWithResultRollupId(interactionNonces: number[], interactionResultRollupId: number) {
    await this.claimRep.update({ interactionNonce: In(interactionNonces) }, { interactionResultRollupId });
  }

  public async confirmClaimed(nullifiers: Buffer[], claimed: Date) {
    await this.claimRep.update({ nullifier: In(nullifiers) }, { claimed });
  }

  public async deleteUnsettledClaimTxs() {
    const unsettledClaim = await this.claimRep.find({
      where: { claimed: IsNull() },
    });
    const nullifiers = unsettledClaim.map(c => c.nullifier);
    await this.txRep.delete({ nullifier1: In(nullifiers) });
  }

  public async resetPositionOnTxsWithoutRollupProof() {
    await this.txRep.update({ rollupProof: IsNull() }, { position: -1 });
  }

  public async eraseDb() {
    await this.connection.transaction(async transactionalEntityManager => {
      await transactionalEntityManager.delete(this.accountRep.target, {});
      await transactionalEntityManager.delete(this.assetMetricsRep.target, {});
      await transactionalEntityManager.delete(this.claimRep.target, {});
      await transactionalEntityManager.delete(this.rollupRep.target, {});
      await transactionalEntityManager.delete(this.rollupProofRep.target, {});
      await transactionalEntityManager.delete(this.txRep.target, {});
    });
  }
}
