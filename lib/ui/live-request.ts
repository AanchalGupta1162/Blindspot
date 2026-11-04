/** Invalidates in-flight reads before a mutation so old polls cannot restore pending approval. */
export class LiveRequestEpoch {
  private epoch = 0;
  capture() { return this.epoch; }
  invalidate() { return ++this.epoch; }
  accepts(epoch: number) { return epoch === this.epoch; }
}
