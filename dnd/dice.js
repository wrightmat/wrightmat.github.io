import DiceBox from "https://unpkg.com/@3d-dice/dice-box@1.0.8/dist/dice-box.es.min.js";

let Box = new DiceBox("#dice-box", {
  assetPath: "assets/",
  origin: "https://unpkg.com/@3d-dice/dice-box@1.0.8/dist/",
  theme: "default",
  themeColor: "#feea03",
  offscreen: true,
  scale: 6
});

Box.init().then(async (world) => {
  Box.roll(["4d20", "4d12", "4d10", "4d8", "4d6", "4d4"]);
});

function get_random(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const button = document.getElementById("rollem");
button.addEventListener("click", (e) => {
  Box.roll(["4d20", "4d12", "4d10", "4d8", "4d6", "4d4"], {
    themeColor: "#348888"
  });
});
