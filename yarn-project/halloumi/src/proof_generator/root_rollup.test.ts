import { HashPath } from '@aztec/barretenberg/merkle_tree';
import { EthAddress } from '@aztec/barretenberg/address';
import { randomBytes } from 'crypto';
import { RootRollup } from './root_rollup.js';

const randomRoot = () => randomBytes(32);
const randomAddress = () => randomBytes(20);
const randomDataPath = () => new HashPath([...Array(32)].map(() => [randomBytes(32), randomBytes(32)]));

describe('Rollup', () => {
  it('serialize rollup data to buffer and deserialize it back', () => {
    const numberOfTxs = 2;
    const proofs = [...Array(numberOfTxs)].map(() => randomBytes(300));
    const rollup = new RootRollup(
      0,
      proofs,
      randomRoot(),
      randomRoot(),
      randomDataPath(),
      randomRoot(),
      randomRoot(),
      randomDataPath(),
      [],
      [],
      [],
      new EthAddress(randomAddress()),
    );

    const buf = rollup.toBuffer();
    expect(buf).toBeInstanceOf(Buffer);

    const recovered = RootRollup.fromBuffer(buf);
    expect(recovered).toEqual(rollup);
  });
});
