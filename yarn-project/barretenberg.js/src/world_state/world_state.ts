import { MerkleTree, MemoryMerkleTree, HashPath } from '../merkle_tree/index.js';
import { WorldStateConstants } from './world_state_constants.js';
import { LevelUp } from 'levelup';
import { Pedersen } from '../crypto/index.js';
import { createDebugLogger } from '../log/index.js';

const debug = createDebugLogger('bb:world_state');

/**
 * Wraps the merkle tree that represents the "mutable" part of the data tree. That is the tree where each leaf
 * is the root of rollups data subtree. Provides ability to compute a complete hash path when given a rollups
 * "immutable" data tree.
 *
 * It is *NOT* safe to concurrently perform reads and writes, due the underlying merkle tree implementation.
 * Even though it does its updates in a batch, the walking of the tree first makes it unsafe.
 * There is no point protecting the merkle tree with a mutex here, as in any practical context, there will be
 * several external reads that need to performed atomically. Thus, the caller is responsible for mutexing reads
 * and write appropriately. Another option would be to change the API here to e.g. `getHashPaths([])`, but
 * that maybe restrictive from a client perspective.
 */
export class WorldState {
  private tree!: MerkleTree;
  private subTreeDepth = 0;

  constructor(private db: LevelUp, private pedersen: Pedersen) {}

  public async init(subTreeDepth: number) {
    const subTreeSize = 1 << subTreeDepth;
    this.subTreeDepth = subTreeDepth;
    const zeroNotes = Array(subTreeSize).fill(MemoryMerkleTree.ZERO_ELEMENT);
    const subTree = await MemoryMerkleTree.new(zeroNotes, this.pedersen);
    const treeSize = WorldStateConstants.DATA_TREE_DEPTH - subTreeDepth;
    const subTreeRoot = subTree.getRoot();
    debug(`initialising data tree with depth ${treeSize} and zero element of ${subTreeRoot.toString('hex')}`);
    try {
      this.tree = await MerkleTree.fromName(this.db, this.pedersen, 'data', subTreeRoot);
    } catch (e) {
      this.tree = await MerkleTree.new(this.db, this.pedersen, 'data', treeSize, subTreeRoot);
    }
    this.logTreeStats();
  }

  // builds a hash path at index 0 for a 'zero' tree of the given depth
  public buildZeroHashPath(depth = WorldStateConstants.DATA_TREE_DEPTH) {
    let current = MemoryMerkleTree.ZERO_ELEMENT;
    const bufs: Buffer[][] = [];
    for (let i = 0; i < depth; i++) {
      bufs.push([current, current]);
      current = this.pedersen.compress(current, current);
    }
    return new HashPath(bufs);
  }

  private convertNoteIndexToSubTreeIndex(noteIndex: number) {
    return noteIndex >> this.subTreeDepth;
  }

  public async buildFullHashPath(noteIndex: number, immutableHashPath: HashPath) {
    const noteSubTreeIndex = this.convertNoteIndexToSubTreeIndex(noteIndex);
    const mutablePath = await this.getHashPath(noteSubTreeIndex);
    const fullHashPath = new HashPath(immutableHashPath.data.concat(mutablePath.data));
    return fullHashPath;
  }

  public async insertElement(index: number, element: Buffer) {
    const subRootIndex = this.convertNoteIndexToSubTreeIndex(index);
    await this.tree.updateElement(subRootIndex, element);
    this.logTreeStats();
  }

  public async insertElements(startIndex: number, elements: Buffer[]) {
    const subRootIndex = this.convertNoteIndexToSubTreeIndex(startIndex);
    await this.tree.updateElements(subRootIndex, elements);
    this.logTreeStats();
  }

  public logTreeStats() {
    debug(`data size: ${this.tree.getSize()}`);
    debug(`data root: ${this.tree.getRoot().toString('hex')}`);
  }

  public async syncFromDb() {
    await this.tree.syncFromDb();
  }

  public async getHashPath(index: number) {
    return await this.tree.getHashPath(index);
  }

  public getRoot() {
    return this.tree.getRoot();
  }

  public getSize() {
    return this.tree.getSize();
  }
}
