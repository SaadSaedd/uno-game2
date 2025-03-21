// Initialize socket connection
// In client.js, replace your socket initialization with:
const socket = io({
    transports: ['polling'],
    forceNew: true
  });

// Game state
let playerID = null;
let roomCode = null;
let isHost = false;
let selectedWildCardIndex = null;
let canPlayDrawnCard = false;
let gameDirection = 'clockwise'; // Track game direction

// DOM elements
const modeSelectionScreen = document.getElementById('modeSelectionScreen');
const multiplayerMenuScreen = document.getElementById('multiplayerMenuScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const roomCodeDisplay = document.getElementById('roomCode');
const playerListElement = document.getElementById('playerList');
const gameStatusElement = document.getElementById('gameStatus');
const playerHandElement = document.getElementById('playerHand');
const otherPlayersElement = document.getElementById('otherPlayers');
const discardPileCardElement = document.getElementById('discardPileCard');
const drawPileCardElement = document.getElementById('drawPileCard');
const startGameButton = document.getElementById('startGameBtn');
const unoButton = document.getElementById('unoBtn');
const colorPickerModal = document.getElementById('colorPickerModal');
const colorOptions = document.querySelectorAll('.color-option');
const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const errorCloseBtn = document.getElementById('errorCloseBtn');
const directionIndicator = document.createElement('div'); // Add direction indicator

// Add direction indicator to the game screen
directionIndicator.id = 'directionIndicator';
directionIndicator.className = 'direction-indicator';
directionIndicator.innerHTML = '⟳'; // Default clockwise
gameScreen.appendChild(directionIndicator);

// Button click handlers
document.getElementById('soloModeBtn').addEventListener('click', () => {
    // Solo mode is not implemented yet
    showError('Solo mode is not implemented yet');
});

document.getElementById('multiplayerModeBtn').addEventListener('click', () => {
    showScreen(multiplayerMenuScreen);
});

document.getElementById('createRoomBtn').addEventListener('click', () => {
    const playerName = document.getElementById('createPlayerName').value.trim();
    if (playerName) {
        socket.emit('createRoom', playerName);
    } else {
        showError('Please enter your name');
    }
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const playerName = document.getElementById('joinPlayerName').value.trim();
    const roomCodeInput = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    
    if (playerName && roomCodeInput) {
        socket.emit('joinRoom', { roomCode: roomCodeInput, playerName });
    } else {
        showError('Please enter your name and room code');
    }
});

document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('startGame');
});

document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
    // Disconnect from room and go back to menu
    socket.disconnect();
    socket.connect();
    showScreen(modeSelectionScreen);
});

// UNO button click handler
unoButton.addEventListener('click', () => {
    socket.emit('callUno');
});

// Draw card handler
drawPileCardElement.addEventListener('click', () => {
    socket.emit('drawCard');
});

// Color picker modal options
colorOptions.forEach(option => {
    option.addEventListener('click', () => {
        const color = option.getAttribute('data-color');
        if (selectedWildCardIndex !== null) {
            // Play wild card with selected color
            socket.emit('playCard', { cardIndex: selectedWildCardIndex, chosenColor: color });
            selectedWildCardIndex = null;
        } else if (canPlayDrawnCard) {
            // Play drawn wild card with selected color
            socket.emit('playDrawnCard', color);
            canPlayDrawnCard = false;
        }
        colorPickerModal.style.display = 'none';
    });
});

// Error modal close button
errorCloseBtn.addEventListener('click', () => {
    errorModal.style.display = 'none';
});

// Socket.io event handlers
socket.on('roomCreated', (data) => {
    roomCode = data.roomCode;
    playerID = data.playerId;
    isHost = true;
    
    roomCodeDisplay.textContent = roomCode;
    showScreen(lobbyScreen);
});

socket.on('roomJoined', (data) => {
    roomCode = data.roomCode;
    playerID = data.playerId;
    
    roomCodeDisplay.textContent = roomCode;
    showScreen(lobbyScreen);
});

socket.on('updatePlayers', (players) => {
    renderPlayerList(players);
    
    // Show or hide start game button based on host status
    if (isHost) {
        startGameButton.classList.remove('hidden');
    } else {
        startGameButton.classList.add('hidden');
    }
});

socket.on('gameState', (gameState) => {
    renderGameState(gameState);
    showScreen(gameScreen);
});

socket.on('gameDirectionChanged', (direction) => {
    // Update direction indicator
    gameDirection = direction;
    updateDirectionIndicator();
    
    // Display direction change message
    gameStatusElement.textContent = `Game direction changed to ${direction}`;
    setTimeout(() => {
        gameStatusElement.textContent = '';
    }, 3000);
});

socket.on('playerSkipped', (data) => {
    // Display skip message
    gameStatusElement.textContent = `${data.playerName}'s turn was skipped!`;
    setTimeout(() => {
        gameStatusElement.textContent = '';
    }, 3000);
});

socket.on('canPlayDrawnCard', (data) => {
    const drawnCard = document.querySelector('#playerHand .card:last-child');
    if (drawnCard) {
        drawnCard.classList.add('playable');
        
        // Check if it's a wild card
        if (data && data.cardType && (data.cardType === 'Wild' || data.cardType === 'Wild Draw Four')) {
            canPlayDrawnCard = true;
            colorPickerModal.style.display = 'block';
        } else {
            // If not a wild card, enable playing it
            drawnCard.addEventListener('click', () => {
                socket.emit('playDrawnCard');
                canPlayDrawnCard = false;
            }, { once: true });
            
            gameStatusElement.textContent = 'You can play the drawn card';
        }
    }
});

socket.on('playerCalledUno', (data) => {
    gameStatusElement.textContent = `${data.playerName} called UNO!`;
    setTimeout(() => {
        gameStatusElement.textContent = '';
    }, 3000);
});

socket.on('playerCaught', (data) => {
    gameStatusElement.textContent = `${data.catcher} caught ${data.caught} without calling UNO! +2 cards`;
    setTimeout(() => {
        gameStatusElement.textContent = '';
    }, 3000);
});

socket.on('gameEnded', (data) => {
    if (data.winner) {
        gameStatusElement.textContent = `Game Over! ${data.winner} wins!`;
    } else {
        gameStatusElement.textContent = `Game Over! ${data.reason}`;
    }
    
    // Add a button to return to lobby
    const returnButton = document.createElement('button');
    returnButton.textContent = 'Return to Lobby';
    returnButton.addEventListener('click', () => {
        socket.disconnect();
        socket.connect();
        showScreen(modeSelectionScreen);
    });
    gameStatusElement.appendChild(returnButton);
});

socket.on('error', (message) => {
    showError(message);
});

// Helper functions
function showScreen(screen) {
    // Hide all screens
    modeSelectionScreen.classList.add('hidden');
    multiplayerMenuScreen.classList.add('hidden');
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    
    // Show the selected screen
    screen.classList.remove('hidden');
}

function renderPlayerList(players) {
    playerListElement.innerHTML = '';
    
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        
        if (player.isHost) {
            li.classList.add('host');
        }
        
        if (player.id === playerID) {
            li.textContent += ' (You)';
        }
        
        playerListElement.appendChild(li);
    });
}

function renderGameState(gameState) {
    // Update game direction if provided
    if (gameState.direction) {
        gameDirection = gameState.direction; // Now directly using the string from server
        updateDirectionIndicator();
    }
    
    // Render player hand
    renderPlayerHand(gameState.hand);
    
    // Render other players
    renderOtherPlayers(gameState.players);
    
    // Render discard pile
    renderDiscardPile(gameState.topCard);
    
    // Update game status
    if (gameState.isYourTurn) {
        gameStatusElement.textContent = "It's your turn";
    } else {
        const currentPlayer = gameState.players.find(p => p.isCurrentPlayer);
        if (currentPlayer) {
            gameStatusElement.textContent = `Waiting for ${currentPlayer.name}`;
        }
    }
    
    // Enable/disable UNO button based on hand size
    unoButton.disabled = gameState.hand.length > 2;
}

function updateDirectionIndicator() {
    directionIndicator.innerHTML = gameDirection === 'clockwise' ? '⟳' : '⟲';
    directionIndicator.title = `Game direction: ${gameDirection}`;
}

function renderPlayerHand(hand) {
    playerHandElement.innerHTML = '';
    
    hand.forEach((card, index) => {
        const cardElement = document.createElement('div');
        cardElement.className = `card card-${card.color}`;
        cardElement.setAttribute('data-index', index);
        cardElement.setAttribute('data-type', card.type);
        
        const cardTypeElement = document.createElement('div');
        cardTypeElement.className = 'card-type';
        cardTypeElement.textContent = card.type;
        
        const cardValueElement = document.createElement('div');
        cardValueElement.className = 'card-value';
        if (card.type === 'Number') {
            cardValueElement.textContent = card.value;
        } else if (card.type === 'Skip') {
            cardValueElement.textContent = '⊘';
        } else if (card.type === 'Reverse') {
            cardValueElement.textContent = '⇄';
        } else if (card.type === 'Draw Two') {
            cardValueElement.textContent = '+2';
        } else if (card.type === 'Wild') {
            cardValueElement.textContent = 'W';
        } else if (card.type === 'Wild Draw Four') {
            cardValueElement.textContent = '+4';
        }
        
        cardElement.appendChild(cardTypeElement);
        cardElement.appendChild(cardValueElement);
        
        // Add click event to play card
        cardElement.addEventListener('click', () => {
            playCard(index, card);
        });
        
        playerHandElement.appendChild(cardElement);
    });
}

function renderOtherPlayers(players) {
    otherPlayersElement.innerHTML = '';
    
    // Sort players based on game direction
    const sortedPlayers = [...players];
    if (gameDirection === 'counterclockwise') {
        // Reverse the order of other players for counterclockwise direction
        sortedPlayers.reverse();
    }
    
    sortedPlayers.forEach(player => {
        // Don't render the current player
        if (player.id === playerID) return;
        
        const playerSlot = document.createElement('div');
        playerSlot.className = 'player-slot';
        if (player.isCurrentPlayer) {
            playerSlot.classList.add('current-player');
        }
        
        const playerInfo = document.createElement('div');
        playerInfo.className = 'player-info';
        
        const playerAvatar = document.createElement('div');
        playerAvatar.className = 'player-avatar';
        playerAvatar.textContent = player.name.charAt(0).toUpperCase();
        
        const playerName = document.createElement('div');
        playerName.className = 'player-name';
        playerName.textContent = player.name;
        if (player.calledUno) {
            playerName.textContent += ' (UNO!)';
        }
        
        playerInfo.appendChild(playerAvatar);
        playerInfo.appendChild(playerName);
        
        const playerHandDisplay = document.createElement('div');
        playerHandDisplay.className = 'player-hand-display';
        
        // Create card backs for number of cards in hand
        for (let i = 0; i < Math.min(player.handCount, 7); i++) {
            const cardBack = document.createElement('div');
            cardBack.className = 'card-back';
            playerHandDisplay.appendChild(cardBack);
        }
        
        // If player has more than 7 cards, show count
        if (player.handCount > 7) {
            const cardCount = document.createElement('div');
            cardCount.className = 'card-count';
            cardCount.textContent = `+${player.handCount - 7}`;
            playerHandDisplay.appendChild(cardCount);
        }
        
        playerSlot.appendChild(playerInfo);
        playerSlot.appendChild(playerHandDisplay);
        
        // Add catch UNO button if player has 1 card and hasn't called UNO
        if (player.handCount === 1 && !player.calledUno) {
            const catchButton = document.createElement('button');
            catchButton.className = 'catch-uno-btn';
            catchButton.textContent = 'Catch!';
            catchButton.addEventListener('click', () => {
                socket.emit('catchUno', player.id);
            });
            playerSlot.appendChild(catchButton);
        }
        
        otherPlayersElement.appendChild(playerSlot);
    });
}

function renderDiscardPile(topCard) {
    discardPileCardElement.innerHTML = '';
    
    if (topCard) {
        const cardElement = document.createElement('div');
        cardElement.className = `card card-${topCard.color}`;
        
        const cardTypeElement = document.createElement('div');
        cardTypeElement.className = 'card-type';
        cardTypeElement.textContent = topCard.type;
        
        const cardValueElement = document.createElement('div');
        cardValueElement.className = 'card-value';
        if (topCard.type === 'Number') {
            cardValueElement.textContent = topCard.value;
        } else if (topCard.type === 'Skip') {
            cardValueElement.textContent = '⊘';
        } else if (topCard.type === 'Reverse') {
            cardValueElement.textContent = '⇄';
        } else if (topCard.type === 'Draw Two') {
            cardValueElement.textContent = '+2';
        } else if (topCard.type === 'Wild') {
            cardValueElement.textContent = 'W';
        } else if (topCard.type === 'Wild Draw Four') {
            cardValueElement.textContent = '+4';
        }
        
        cardElement.appendChild(cardTypeElement);
        cardElement.appendChild(cardValueElement);
        
        discardPileCardElement.appendChild(cardElement);
    }
}

function playCard(index, card) {
    // If it's a wild card, show color picker first
    if (card.type === 'Wild' || card.type === 'Wild Draw Four') {
        selectedWildCardIndex = index;
        colorPickerModal.style.display = 'block';
    } else {
        // Otherwise play the card directly
        socket.emit('playCard', { cardIndex: index });
    }
}

function showError(message) {
    errorMessage.textContent = message;
    errorModal.style.display = 'block';
}

// Initialize app
showScreen(modeSelectionScreen);