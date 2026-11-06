// utils/queue.js
class Queue {
  constructor(delayMs = 0) {
    this.delayMs = delayMs;
    this.running = false;
    this.tasks = [];
  }

  add(taskFn) {
    return new Promise((resolve, reject) => {
      this.tasks.push({ taskFn, resolve, reject });
      this._run();
    });
  }

  async _run() {
    if (this.running || this.tasks.length === 0) return;
    this.running = true;
    const { taskFn, resolve, reject } = this.tasks.shift();
    try {
      const result = await taskFn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.running = false;
      setTimeout(() => this._run(), this.delayMs);
    }
  }
}

module.exports = Queue;
