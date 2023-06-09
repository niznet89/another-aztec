import { TxHash } from '@aztec/barretenberg/blockchain';
import {
  AfterInsert,
  AfterLoad,
  AfterUpdate,
  Column,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { AssetMetricsDao } from './asset_metrics.js';
import { BridgeMetricsDao } from './bridge_metrics.js';
import { bufferColumn } from './buffer_column.js';
import { RollupProofDao } from './rollup_proof.js';
import { txHashTransformer } from './transformer.js';

@Entity({ name: 'rollup' })
export class RollupDao {
  public constructor(init?: Partial<RollupDao>) {
    Object.assign(this, init);
  }

  @PrimaryColumn()
  public id!: number;

  @Column(...bufferColumn({ unique: true, length: 32 }))
  public dataRoot!: Buffer;

  @OneToOne(() => RollupProofDao, rollupPoof => rollupPoof.rollup, { cascade: true })
  public rollupProof!: Relation<RollupProofDao>;

  @OneToMany(() => AssetMetricsDao, am => am.rollup, { cascade: true })
  public assetMetrics!: Relation<AssetMetricsDao>[];

  @OneToMany(() => BridgeMetricsDao, bm => bm.rollup, { cascade: true })
  public bridgeMetrics!: BridgeMetricsDao[];

  // Null until computed.
  @Column(...bufferColumn({ nullable: true }))
  public processRollupCalldata?: Buffer;

  // Null until mined and events fetched.
  @Column(...bufferColumn({ nullable: true }))
  public interactionResult?: Buffer;

  // Null until tx sent.
  @Column(...bufferColumn({ nullable: true, length: 32, transformer: [txHashTransformer] }))
  public ethTxHash?: TxHash;

  // Null until mined.
  @Column(...bufferColumn({ nullable: true, length: 32 }))
  public gasPrice?: Buffer;

  // Null until mined.
  @Column({ nullable: true })
  public gasUsed?: number;

  // Null until mined.
  @Column({ nullable: true })
  @Index()
  public mined?: Date;

  // Null until mined.
  @Column(...bufferColumn({ nullable: true, length: 32 }))
  public subtreeRoot?: Buffer;

  @AfterLoad()
  @AfterInsert()
  @AfterUpdate()
  afterLoad() {
    if (!this.processRollupCalldata) {
      delete this.processRollupCalldata;
    }
    if (!this.interactionResult) {
      delete this.interactionResult;
    }
    if (!this.ethTxHash) {
      delete this.ethTxHash;
    }
    if (this.gasPrice === null) {
      delete this.gasPrice;
    }
    if (this.gasUsed === null) {
      delete this.gasUsed;
    }
    if (!this.mined) {
      delete this.mined;
    }
    if (!this.subtreeRoot) {
      delete this.subtreeRoot;
    }
  }
}
