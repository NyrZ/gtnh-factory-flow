/*
 * Paste this into the DevTools console on the board, then pan for ~8 seconds.
 *
 * It answers the questions the automated harness cannot, because they are
 * properties of YOUR session rather than of the code: how long the main thread
 * is blocked for, how late an input is handled, how many pixels the board is
 * actually rasterising, and what is on screen while it happens.
 *
 * Nothing is sent anywhere; it prints to the console.
 */
(() => {
  const longTasks = [];
  const inputDelays = [];

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push(Math.round(entry.duration));
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    console.warn("longtask observer unavailable");
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // How long between the input arriving and the handler starting: this is
        // the "I move the mouse and it responds a second later" number.
        inputDelays.push(Math.round(entry.processingStart - entry.startTime));
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {
    console.warn("event-timing observer unavailable");
  }

  const started = performance.now();
  let frames = 0;
  const tick = () => {
    frames += 1;
    if (performance.now() - started < 8000) {
      requestAnimationFrame(tick);
    } else {
      report();
    }
  };
  requestAnimationFrame(tick);

  console.log("%cPan the board now — measuring for 8 seconds...", "font-weight:bold");

  function report() {
    const seconds = (performance.now() - started) / 1000;
    const board = document.querySelector(".react-flow");
    const worst = [...longTasks].sort((a, b) => b - a);
    const delays = [...inputDelays].sort((a, b) => b - a);
    console.log("%c--- board probe ---", "font-weight:bold");
    console.log("rAF ticks/sec:      ", (frames / seconds).toFixed(1));
    console.log("long tasks >50ms:   ", longTasks.length, "worst:", worst.slice(0, 8));
    console.log("total blocked (ms): ", longTasks.reduce((sum, d) => sum + d, 0));
    console.log("input delays (ms):  ", delays.slice(0, 8));
    console.log("devicePixelRatio:   ", window.devicePixelRatio);
    console.log(
      "board size:         ",
      board ? `${board.clientWidth}x${board.clientHeight}` : "not found",
    );
    console.log(
      "on screen:          ",
      document.querySelectorAll(".react-flow__node").length,
      "nodes,",
      document.querySelectorAll(".react-flow__edge").length,
      "edges,",
      document.querySelectorAll(".react-flow__node *").length,
      "elements inside nodes",
    );
    console.log(
      "board view:         ",
      localStorage.getItem("gtnh-factory-flow-board-view"),
    );
    console.log("zoom:               ", (() => {
      const viewport = document.querySelector(".react-flow__viewport");
      return viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a.toFixed(2) : "?";
    })());
    console.log("build:              ", process?.env?.NODE_ENV ?? "(unknown)", navigator.userAgent);
  }
})();
