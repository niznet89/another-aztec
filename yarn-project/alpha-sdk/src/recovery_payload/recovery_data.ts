import { GrumpkinAddress } from '@aztec/barretenberg/address';
import { SchnorrSignature } from '@aztec/barretenberg/crypto';

export class RecoveryData {
  constructor(public accountPublicKey: GrumpkinAddress, public signature: SchnorrSignature) {}

  static fromBuffer(data: Buffer) {
    let dataStart = 0;
    const accountPublicKey = new GrumpkinAddress(data.slice(dataStart, dataStart + GrumpkinAddress.SIZE));
    dataStart += GrumpkinAddress.SIZE;
    const signature = new SchnorrSignature(data.slice(dataStart, dataStart + SchnorrSignature.SIZE));
    return new RecoveryData(accountPublicKey, signature);
  }

  static fromString(data: string) {
    return RecoveryData.fromBuffer(Buffer.from(data.replace(/^0x/i, ''), 'hex'));
  }

  toBuffer() {
    return Buffer.concat([this.accountPublicKey.toBuffer(), this.signature.toBuffer()]);
  }

  toString() {
    return `0x${this.toBuffer().toString('hex')}`;
  }
}
