import { SchnorrSignature } from '../../crypto/index.js';
import { executeTimeout } from '../../timer/index.js';
import { Transfer } from '../../transport/index.js';
import { UnrolledProver } from '../prover/index.js';
import { AccountTx } from './account_tx.js';
import { createAccountProofSigningData } from './create_account_proof_signing_data.js';

export class AccountProver {
  constructor(private prover: UnrolledProver, public readonly mock = false) {}

  static getCircuitSize(proverless = false) {
    return proverless ? 512 : 32 * 1024;
  }

  public async computeKey(timeout?: number) {
    const worker = this.prover.getWorker();
    await executeTimeout(
      async () => await worker.asyncCall('account__init_proving_key', this.mock),
      timeout,
      'AccountProver.computeKey',
    );
  }

  public async releaseKey() {
    const worker = this.prover.getWorker();
    await worker.call('account__release_key');
  }

  public async loadKey(keyBuf: Buffer) {
    const worker = this.prover.getWorker();
    const keyPtr = await worker.call('bbmalloc', keyBuf.length);
    await worker.transferToHeap(Transfer(keyBuf, [keyBuf.buffer]) as any, keyPtr);
    await worker.call('account__init_proving_key_from_buffer', keyPtr);
    await worker.call('bbfree', keyPtr);
  }

  public async getKey() {
    const worker = this.prover.getWorker();
    await worker.acquire();
    try {
      const keySize = await worker.call('account__get_new_proving_key_data', 0);
      const keyPtr = Buffer.from(await worker.sliceMemory(0, 4)).readUInt32LE(0);
      const buf = Buffer.from(await worker.sliceMemory(keyPtr, keyPtr + keySize));
      await worker.call('bbfree', keyPtr);
      return buf;
    } finally {
      await worker.release();
    }
  }

  public async computeSigningData(tx: AccountTx) {
    const worker = this.prover.getWorker();
    return await createAccountProofSigningData(tx, worker);
  }

  public async createAccountProof(tx: AccountTx, signature: SchnorrSignature, timeout?: number) {
    const worker = this.prover.getWorker();
    const buf = Buffer.concat([tx.toBuffer(), signature.toBuffer()]);
    const mem = await worker.call('bbmalloc', buf.length);
    await worker.transferToHeap(buf, mem);
    const proverPtr = await worker.asyncCall('account__new_prover', mem, this.mock);
    await worker.call('bbfree', mem);
    const proof = await this.prover.createProof(proverPtr, timeout);
    await worker.call('account__delete_prover', proverPtr);
    return proof;
  }

  public getProver() {
    return this.prover;
  }
}
