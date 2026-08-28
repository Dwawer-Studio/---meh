'use strict';

const UI = {
    get mainMenu() { return document.getElementById('main-menu'); },
    get instructionsScreen() { return document.getElementById('instructions-screen'); },
    get gameScreen() { return document.getElementById('game-screen'); },
    get endScreen() { return document.getElementById('end-screen'); },
    get drawPile() { return document.getElementById('draw-pile'); },
    get discardPile() { return document.getElementById('discard-pile'); },
    get colorPicker() { return document.getElementById('color-picker'); },
    get playerPicker() { return document.getElementById('player-picker'); },
    get playerPickerList() { return document.getElementById('player-picker-list'); },
    get choiceModal() { return document.getElementById('choice-modal'); },
    get turnIndicator() { return document.getElementById('current-player-name'); },
    get gameMessage() { return document.getElementById('game-message'); },
    get toastContainer() { return document.getElementById('toast-container'); },
    get winnerText() { return document.getElementById('winner-text'); },
    get confirmBar() { return document.getElementById('confirm-bar'); },
};

const playersConfig = [
    { id: 'human', name: 'أنت', avatar: '😎', isBot: false, containerId: 'human-hand', countId: null },
    { id: 'bot-1', name: 'أحمد', avatar: '🤖', isBot: true, containerId: 'bot-1-hand', countId: 'bot-1-count' },
    { id: 'bot-2', name: 'نورة', avatar: '🤖', isBot: true, containerId: 'bot-2-hand', countId: 'bot-2-count' },
    { id: 'bot-3', name: 'خالد', avatar: '🤖', isBot: true, containerId: 'bot-3-hand', countId: 'bot-3-count' },
];

// بطاقات شاشة التعليمات (الاسم العربي الثابت + ملف الصورة)
const INSTR_SPECIAL = [
    { ar: 'مه', img: 'black-meh' },
    { ar: 'شنو كنت تقول', img: 'black-draw4Wild' },
    { ar: 'طلعت يا محلى نورها', img: 'black-wild' },
    { ar: 'انثبر مكانك', img: 'orange-skip' },
    { ar: 'يوتيرن', img: 'orange-reverse' },
    { ar: 'اسكت اسكت', img: 'orange-draw2' },
    { ar: 'هجمة مرتدة', img: 'orange-counterAttack' },
    { ar: 'أنا آسف', img: 'orange-sorry' },
    { ar: 'انت احسن واحد', img: 'orange-bestOne' },
];
const INSTR_POWER = [
    { ar: 'بوشلاخ', img: 'orange-boShlakh' },
    { ar: 'الحرباية', img: 'orange-chameleon' },
    { ar: 'ام وجهين', img: 'orange-umWajhain' },
    { ar: 'النوخذه', img: 'orange-nokhtha' },
    { ar: 'دراما كوين', img: 'orange-dramaQueen' },
    { ar: 'افلاطون', img: 'orange-plato' },
    { ar: 'شوقر', img: 'orange-sugar' },
    { ar: 'الهامور', img: 'orange-hamour' },
    { ar: 'فانتوم', img: 'orange-phantom' },
];

const AVATARS = ['😎','😀','😂','🤩','😍','🥳','🤠','👻','🐱','🦁','🐯','🦄','🐲','🤖','👑','🌟'];
const ONLINE_COLORS = ['orange', 'gray', 'purple'];
const MAX_ONLINE_PLAYERS = 4;
const MAX_PLAYER_NAME_LENGTH = 24;
