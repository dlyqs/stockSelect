/** One timer independent of window visibility; no overlapping asynchronous cycles. */
export class PaperScheduler {
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  private pending: Promise<void> = Promise.resolve()
  constructor(private cycle: () => Promise<void>, private onError: (error: unknown) => void = () => {}) {}
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (this.busy) return
      this.busy = true
      this.pending = this.cycle().catch(this.onError).finally(() => { this.busy = false })
    },5000)
    this.timer.unref()
  }
  async drain(): Promise<void> { await this.pending }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined }
}
