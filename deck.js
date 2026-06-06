class Card {
    constructor(color, name, type, emoji, svgFile) {
        this.color = color;
        this.name = name;
        this.type = type;
        this.emoji = emoji;
        this.svgFile = svgFile;
        this.id = Math.random().toString(36).substr(2, 9);
    }
    isPlayable(topCard, activeColor) {
        if (this.color === 'black') return true;
        if (this.color === activeColor) return true;
        if (this.name === topCard.name) return true;
        return false;
    }
}

class Deck {
    constructor() {
        this.cards = [];
        this.buildDeck();
        this.shuffle();
    }
    buildDeck() {
        const cardDefs = [
            { name: 'اسكت اسكت', type: 'draw2', emoji: '🤫' },
            { name: 'افلاطون', type: 'plato', emoji: '🏛️' },
            { name: 'الحرباية', type: 'chameleon', emoji: '🦎' },
            { name: 'الدافور', type: 'normal', emoji: '🔥', img: 'dafour' },
            { name: 'الرجل الصندوق', type: 'normal', emoji: '📦', img: 'boxMan' },
            { name: 'النوخذه', type: 'nokhtha', emoji: '⚓' },
            { name: 'الهامور', type: 'hamour', emoji: '🦈' },
            { name: 'انت احسن واحد', type: 'bestOne', emoji: '🌳' },
            { name: 'انثبر مكانك', type: 'skip', emoji: '🛑' },
            { name: 'أنا آسف', type: 'sorry', emoji: '🤜' },
            { name: 'ام حمار', type: 'normal', emoji: '🐴', img: 'umHumar' },
            { name: 'ام كشة', type: 'normal', emoji: '👩', img: 'umKasha' },
            { name: 'ام وجهين', type: 'umWajhain', emoji: '🎭' },
            { name: 'بوشلاخ', type: 'boShlakh', emoji: '🗣️' },
            { name: 'دراما كوين', type: 'dramaQueen', emoji: '👸' },
            { name: 'شوقر', type: 'sugar', emoji: '🍬' },
            { name: 'فانتوم', type: 'phantom', emoji: '🦇' },
            { name: 'يوتيرن', type: 'reverse', emoji: '🔄' },
            { name: 'هجمة مرتدة', type: 'counterAttack', emoji: '⚡' },
        ];

        const colors = ['orange', 'gray', 'purple'];
        for (const color of colors) {
            for (const def of cardDefs) {
                const imgBase = def.img || def.type;
                const imgFile = `assets/cards/${color}-${imgBase}.webp`;
                this.cards.push(new Card(color, def.name, def.type, def.emoji, imgFile));
            }
        }

        // Black cards
        this.cards.push(new Card('black', 'مه', 'meh', '🃏', 'assets/cards/black-meh.webp'));
        this.cards.push(new Card('black', 'شنو كنت تقول', 'draw4Wild', '📜', 'assets/cards/black-draw4Wild.webp'));
        this.cards.push(new Card('black', 'طلعت يا محلى نورها', 'wild', '📺', 'assets/cards/black-wild.webp'));
    }
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }
    draw() {
        return this.cards.length > 0 ? this.cards.pop() : null;
    }
}
