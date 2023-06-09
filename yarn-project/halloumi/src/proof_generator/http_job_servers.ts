import { ProofGenerator } from './proof_generator.js';
import { HttpJobServer } from './http_job_server.js';
import { ProofId } from './proof_request.js';

/**
 * Wraps instances of HttpJobServer to allow farming out different job types on different queues.
 */
export class HttpJobServers implements ProofGenerator {
  private txRollupAndClaimServer: HttpJobServer;
  private rootAndVerifierServer: HttpJobServer;

  constructor(ackTimeout = 5000) {
    this.txRollupAndClaimServer = new HttpJobServer(8082, ackTimeout);
    this.rootAndVerifierServer = new HttpJobServer(8083, ackTimeout);
  }

  public async start() {
    await this.txRollupAndClaimServer.start();
    await this.rootAndVerifierServer.start();
  }

  public async stop() {
    await this.txRollupAndClaimServer.stop();
    await this.rootAndVerifierServer.stop();
  }

  public async interrupt() {
    await this.txRollupAndClaimServer.interrupt();
    await this.rootAndVerifierServer.interrupt();
  }

  public getJoinSplitVk() {
    return this.rootAndVerifierServer.getJoinSplitVk();
  }

  public getAccountVk() {
    return this.rootAndVerifierServer.getAccountVk();
  }

  public createProof(data: Buffer): Promise<Buffer> {
    const proofId = data.readUInt32BE(0) as ProofId;
    if (proofId == ProofId.CLAIM || proofId == ProofId.TX_ROLLUP) {
      return this.txRollupAndClaimServer.createProof(data);
    } else {
      return this.rootAndVerifierServer.createProof(data);
    }
  }
}
