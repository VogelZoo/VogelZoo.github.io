const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let glider = {
    x: canvas.width / 4,
    y: canvas.height / 2,
    width: 50,
    height: 20,
    tilt: 0, // positive for up, negative for down
    speed: 2, // horizontal speed
    altitude: 0, // vertical depth
};

let isTiltingUp = false;
let isTiltingDown = false;

// Handle user input
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') isTiltingUp = true;
    if (e.key === 'ArrowDown') isTiltingDown = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp') isTiltingUp = false;
    if (e.key === 'ArrowDown') isTiltingDown = false;
});

// Game loop
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update glider position
    if (isTiltingUp) {
        glider.tilt += 0.05;
        glider.altitude -= glider.tilt;
    } else if (isTiltingDown) {
        glider.tilt -= 0.05;
        glider.altitude += glider.tilt;
    } else {
        glider.tilt *= 0.98; // Gradual stabilization
    }

    glider.altitude += 1; // Gravity effect

    // Draw glider
    ctx.fillStyle = '#0ff';
    ctx.fillRect(glider.x, canvas.height - glider.altitude, glider.width, glider.height);

    requestAnimationFrame(gameLoop);
}

gameLoop();