document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const mainMenu = document.getElementById('main-menu');
    const instructionsScreen = document.getElementById('instructions-screen');
    
    // Buttons
    const playBtn = document.getElementById('play-btn');
    const instructionsBtn = document.getElementById('instructions-btn');
    const backBtn = document.getElementById('back-btn');

    // Navigation Functions
    function showScreen(screen) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.remove('active');
        });
        
        // Show target screen
        screen.classList.add('active');
    }

    // Event Listeners
    playBtn.addEventListener('click', () => {
        // Here we will transition to the game setup or actual game screen
        alert('جاري تجهيز اللعبة...');
    });

    instructionsBtn.addEventListener('click', () => {
        showScreen(instructionsScreen);
    });

    backBtn.addEventListener('click', () => {
        showScreen(mainMenu);
    });
});
