const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms
const rooms = {};

// Player connections
const playerConnections = {};

// Generate a random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    // Create a new game room
    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        
        rooms[roomCode] = {
            players: [{
                id: socket.id,
                name: playerName,
                isHost: true
            }],
            state: 'waiting', // waiting, playing, ended
            deck: null,
            currentPlayerIndex: 0,
            discardPile: [],
            direction: 1
        };
        
        playerConnections[socket.id] = roomCode;
        socket.join(roomCode);
        
        socket.emit('roomCreated', { roomCode, playerId: socket.id });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });
    
    // Join an existing room
    socket.on('joinRoom', ({ roomCode, playerName }) => {
        const room = rooms[roomCode];
        
        if (!room) {
            socket.emit('error', 'Room does not exist');
            return;
        }
        
        if (room.state !== 'waiting') {
            socket.emit('error', 'Game already in progress');
            return;
        }
        
        if (room.players.length >= 4) {
            socket.emit('error', 'Room is full');
            return;
        }
        
        // Add player to room
        room.players.push({
            id: socket.id,
            name: playerName,
            isHost: false
        });
        
        playerConnections[socket.id] = roomCode;
        socket.join(roomCode);
        
        socket.emit('roomJoined', { roomCode, playerId: socket.id });
        io.to(roomCode).emit('updatePlayers', room.players);
    });
    
    // Start the game
    socket.on('startGame', () => {
        const roomCode = playerConnections[socket.id];
        const room = rooms[roomCode];
        
        if (!room) return;
        
        // Check if player is host
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) return;
        
        if (room.players.length < 2) {
            socket.emit('error', 'Need at least 2 players to start');
            return;
        }
        
        // Initialize game
        initGame(room);
        room.state = 'playing';
        
        // Send initial game state to all players
        sendGameState(roomCode);
    });
    
    // Play a card
    socket.on('playCard', ({ cardIndex, chosenColor }) => {
        const roomCode = playerConnections[socket.id];
        const room = rooms[roomCode];
        
        if (!room || room.state !== 'playing') return;
        
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.currentPlayerIndex) {
            socket.emit('error', 'Not your turn');
            return;
        }
        
        // Process the card play
        processCardPlay(room, playerIndex, cardIndex, chosenColor, roomCode);
        
        // Send updated game state to all players
        sendGameState(roomCode);
    });
    
    // Draw a card
    socket.on('drawCard', () => {
        const roomCode = playerConnections[socket.id];
        const room = rooms[roomCode];
        
        if (!room || room.state !== 'playing') return;
        
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.currentPlayerIndex) {
            socket.emit('error', 'Not your turn');
            return;
        }
        
        // Draw a card for the player
        const player = room.players[playerIndex];
        const card = drawCard(room);
        player.hand.push(card);
        
        // Check if the drawn card can be played
        const topCard = room.discardPile[room.discardPile.length - 1];
        if (isValidPlay(topCard, card)) {
            // Player can play the drawn card if they want
            socket.emit('canPlayDrawnCard', { cardType: card.type });
        } else {
            // Move to next player
            nextPlayer(room, roomCode);
            sendGameState(roomCode);
        }
    });
    
    // Player wants to play the drawn card
    socket.on('playDrawnCard', (chosenColor) => {
        const roomCode = playerConnections[socket.id];
        const room = rooms[roomCode];
        
        if (!room || room.state !== 'playing') return;
        
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        const player = room.players[playerIndex];
        
        // Play the last card in the player's hand
        const cardIndex = player.hand.length - 1;
        processCardPlay(room, playerIndex, cardIndex, chosenColor, roomCode);
        
        // Send updated game state
        sendGameState(roomCode);
    });
    
    // Call UNO
    socket.on('callUno', () => {
        const roomCode = playerConnections[socket.id];
        const room = rooms[roomCode];
        
        if (!room || room.state !== 'playing') return;
        
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        const player = room.players[playerIndex];
        
        // Check if player has one card left
        if (player.hand.length === 1) {
            player.calledUno = true;
            io.to(roomCode).emit('playerCalledUno', { playerName: player.name });
        } else if (player.hand.length === 2) {
            // Pre-emptive UNO call
            player.calledUno = true;
            io.to(roomCode).emit('playerCalledUno', { playerName: player.name });
        } else {
            // Check if any other player has one card and hasn't called UNO
            let caughtPlayer = null;
            for (let i = 0; i < room.players.length; i++) {
                if (i !== playerIndex && room.players[i].hand.length === 1 && !room.players[i].calledUno) {
                    caughtPlayer = room.players[i];
                    break;
                }
            }
            
            if (caughtPlayer) {
                // Player caught someone without calling UNO
                for (let i = 0; i < 2; i++) {
                    const card = drawCard(room);
                    caughtPlayer.hand.push(card);
                }
                
                io.to(roomCode).emit('playerCaught', { 
                    catcher: player.name, 
                    caught: caughtPlayer.name 
                });
                
                sendGameState(roomCode);
            }
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        const roomCode = playerConnections[socket.id];
        
        if (roomCode && rooms[roomCode]) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                // Remove the player
                room.players.splice(playerIndex, 1);
                
                // If the room is empty, delete it
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else {
                    // If the host left, assign a new host
                    if (playerIndex === 0 || room.players.every(p => !p.isHost)) {
                        room.players[0].isHost = true;
                    }
                    
                    // If game was in progress, either end it or adjust currentPlayerIndex
                    if (room.state === 'playing') {
                        if (room.players.length < 2) {
                            room.state = 'ended';
                            io.to(roomCode).emit('gameEnded', { reason: 'Not enough players' });
                        } else {
                            // Adjust currentPlayerIndex if needed
                            if (playerIndex < room.currentPlayerIndex) {
                                room.currentPlayerIndex--;
                            } else if (playerIndex === room.currentPlayerIndex) {
                                // It was this player's turn
                                if (room.currentPlayerIndex >= room.players.length) {
                                    room.currentPlayerIndex = 0;
                                }
                                // Continue with the next player
                                nextPlayer(room, roomCode);
                            }
                            
                            sendGameState(roomCode);
                        }
                    }
                    
                    io.to(roomCode).emit('updatePlayers', room.players);
                }
            }
            
            delete playerConnections[socket.id];
        }
        
        console.log('User disconnected:', socket.id);
    });
});

// Game logic functions
function initGame(room) {
    // Create a new deck
    room.deck = createDeck();
    
    // Deal cards to players
    room.players.forEach(player => {
        player.hand = [];
        player.calledUno = false;
        for (let i = 0; i < 7; i++) {
            player.hand.push(drawCard(room));
        }
    });
    
    // Initial discard card
    let startCard;
    do {
        startCard = drawCard(room);
        // Initial card shouldn't be a wild card
        if (startCard.type === 'Wild' || startCard.type === 'Wild Draw Four') {
            room.deck.unshift(startCard);
            shuffleDeck(room.deck);
        } else {
            break;
        }
    } while (true);
    
    room.discardPile = [startCard];
    
    // Handle if starting card is an action card
    if (startCard.type !== 'Number') {
        handleSpecialCardEffects(room, startCard);
    }
}

function createDeck() {
    const deck = [];
    const colors = ['Red', 'Blue', 'Green', 'Yellow'];
    const numbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const actionCards = ['Skip', 'Reverse', 'Draw Two'];
    
    // Create number cards
    colors.forEach(color => {
        numbers.forEach(number => {
            const quantity = number === '0' ? 1 : 2;
            for (let i = 0; i < quantity; i++) {
                deck.push({ color, type: 'Number', value: number });
            }
        });
        
        // Create action cards
        actionCards.forEach(action => {
            for (let i = 0; i < 2; i++) {
                deck.push({ color, type: action });
            }
        });
    });
    
    // Create Wild cards and Wild Draw Four cards
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'Wild', type: 'Wild' });
        deck.push({ color: 'Wild', type: 'Wild Draw Four' });
    }
    
    shuffleDeck(deck);
    return deck;
}

function drawCard(room) {
    if (room.deck.length === 0) {
        // If deck is empty, recycle cards from discard pile
        const topCard = room.discardPile.pop();
        room.deck = [...room.discardPile];
        room.discardPile = [topCard];
        shuffleDeck(room.deck);
    }
    return room.deck.pop();
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

function isValidPlay(topCard, cardToPlay) {
    // Wild cards can always be played
    if (cardToPlay.type === 'Wild' || cardToPlay.type === 'Wild Draw Four') {
        return true;
    }
    
    // Match by color
    if (topCard.color === cardToPlay.color) {
        return true;
    }
    
    // Match by type/value
    if (topCard.type === 'Number' && cardToPlay.type === 'Number') {
        return topCard.value === cardToPlay.value;
    }
    
    // Match by action type
    if (topCard.type === cardToPlay.type) {
        return true;
    }
    
    return false;
}

function processCardPlay(room, playerIndex, cardIndex, chosenColor, roomCode) {
    const player = room.players[playerIndex];
    const card = player.hand[cardIndex];
    
    // Remove the card from hand
    player.hand.splice(cardIndex, 1);
    
    // If it's a wild card, set the chosen color
    if (chosenColor && (card.type === 'Wild' || card.type === 'Wild Draw Four')) {
        card.color = chosenColor;
    }
    
    // Add to discard pile
    room.discardPile.push(card);
    
    // Reset UNO call status for next round
    room.players.forEach(p => p.calledUno = false);
    
    // Check if player has won
    if (player.hand.length === 0) {
        room.state = 'ended';
        io.to(roomCode).emit('gameEnded', { 
            winner: player.name 
        });
        return;
    }
    
    // Handle special card effects
    handleSpecialCardEffects(room, card, roomCode);
    
    // If not Skip, Reverse, Draw Two, or Wild Draw Four, switch turns normally
    if (card.type !== 'Skip' && 
        card.type !== 'Reverse' && 
        card.type !== 'Draw Two' && 
        card.type !== 'Wild Draw Four') {
        nextPlayer(room, roomCode);
    }
}

function handleSpecialCardEffects(room, card, roomCode) {
    // Store the current direction before any changes
    const oldDirection = room.direction;
    
    switch(card.type) {
        case 'Skip':
            // Skip next player's turn
            const skippedPlayerIndex = getNextPlayerIndex(room);
            const skippedPlayer = room.players[skippedPlayerIndex];
            io.to(roomCode).emit('playerSkipped', { playerName: skippedPlayer.name });
            nextPlayer(room, roomCode);
            break;
            
        case 'Reverse':
            // Reverse direction
            room.direction *= -1;
            // Emit direction change event
            io.to(roomCode).emit('gameDirectionChanged', room.direction === 1 ? 'clockwise' : 'counterclockwise');
            
            // In a two-player game, Reverse acts like Skip
            if (room.players.length === 2) {
                nextPlayer(room, roomCode);
            }
            break;
            
        case 'Draw Two':
            // Move to next player
            nextPlayer(room, roomCode);
            const drawTwoPlayer = room.players[room.currentPlayerIndex];
            
            // Player draws 2 cards
            for (let i = 0; i < 2; i++) {
                drawTwoPlayer.hand.push(drawCard(room));
            }
            
            // Skip their turn
            nextPlayer(room, roomCode);
            break;
            
        case 'Wild Draw Four':
            // Move to next player
            nextPlayer(room, roomCode);
            const drawFourPlayer = room.players[room.currentPlayerIndex];
            
            // Player draws 4 cards
            for (let i = 0; i < 4; i++) {
                drawFourPlayer.hand.push(drawCard(room));
            }
            
            // Skip their turn
            nextPlayer(room, roomCode);
            break;
    }
}

function getNextPlayerIndex(room) {
    return (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
}

function nextPlayer(room, roomCode) {
    // Calculate next player index
    room.currentPlayerIndex = getNextPlayerIndex(room);
}

function sendGameState(roomCode) {
    const room = rooms[roomCode];
    
    // Prepare game state for all players
    room.players.forEach(player => {
        // Create a player-specific game state
        const playerState = {
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                handCount: p.hand.length,
                calledUno: p.calledUno,
                isCurrentPlayer: p.id === room.players[room.currentPlayerIndex].id
            })),
            // Send the player's own hand
            hand: player.hand,
            // Top card of discard pile
            topCard: room.discardPile[room.discardPile.length - 1],
            // Direction (converted to string for client)
            direction: room.direction === 1 ? 'clockwise' : 'counterclockwise',
            // Is it this player's turn?
            isYourTurn: player.id === room.players[room.currentPlayerIndex].id
        };
        
        io.to(player.id).emit('gameState', playerState);
    });
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});