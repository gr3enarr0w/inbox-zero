(() => {
  function createBoundedRead(read, timeoutMs = 20_000) {
    if (typeof read !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000)
      throw new Error("Invalid native read deadline");
    let active;
    return (command) => {
      if (active) return Promise.reject(new Error("READ_FAILED"));
      const operation = Promise.resolve().then(() => read(command));
      active = operation;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("READ_FAILED")), timeoutMs);
        operation.then(
          (value) => { active = undefined; clearTimeout(timer); resolve(value); },
          (error) => { active = undefined; clearTimeout(timer); reject(error); },
        );
      });
    };
  }
  globalThis.InboxZeroBoundedRead = Object.freeze({ createBoundedRead });
})();
