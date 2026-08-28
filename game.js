'use strict';

class MehGame {
    constructor() {
        this.deck = null;
        this.discardPile = [];
        this.players = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;
        this.activeColor = '';
        this.pendingDraws = 0;
        this.isAwaitingColor = false;
        this.actionInProgress = false;
        this.skipNextMap = {};
        this.superpowersDisabled = false;
        this._sugarOwnerId = null;
        this.selectedCardIndex = -1;      // لتأكيد رمي البطاقة
        this.drawImmune = {};             // درع الفانتوم: حصانة ضد السحب
        this.humanCanPlay = false;        // بوابة صريحة: متى يُسمح للاعب البشري بالفعل
        this.lobbyPlayers = [];           // لاعبو الردهة (أونلاين)
        this.online = false;              // وضع اللعب الجماعي
        this.isHost = false;              // المضيف يدير منطق اللعبة
        this.myIndex = 0;                 // مقعد هذا الجهاز (دائماً 0 في عرضه)
        this.awaitingRemote = false;      // المضيف ينتظر حركة لاعب بعيد
        this.turnTimer = null;            // مؤقّت الدور (لعب تلقائي عند التأخّر)
        this._promptTimer = null;
        this._bcTimer = null;
        this._disconnectTurnTimer = null;
        this._remoteResolve = null;
        this._remotePromptSeq = 0;
        this._remotePromptId = null;
        this._remotePromptPeer = null;
        this._remoteAllowedValues = null;
        this._colorCallback = null;
        this._joinRejected = false;
        this._rejectedConnections = new WeakSet();
        this._pendingAvatar = '😎';
        this._initializeProductEvidence();
        this._initializeTableRuntime();
        this._initializeGuidance();

        // الإعدادات والعضو
        this.settings = Storage.getSettings();
        this.humanProfile = Storage.getCurrentProfile()
            || { name: I18n.t('guest'), avatar: '😎', guest: true };

        // Dev options
        this.devShowBotHands = false;
        window.game = this;

        this.applySettings();
        this.bindMenuEvents();
        this.bindDevEvents();
        this.bindSettingsEvents();
        this.bindProfileEvents();
        this.bindEmojiEvents();
        this.bindOnlineEvents();
        this.bindInviteEvents();
        this.bindGuidanceEvents();
        this.renderInstructions();
        this.initProfile();
        this._initializeInviteEntry();
        this.syncScreenAccessibility();
        this.runSplash();

        // صوت نقرة عام للأزرار
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn, .corner-btn, .emoji-toggle-btn, .lang-btn, .picker-btn, .avatar-option, .profile-item')) {
                Sound.play('click');
            }
        });
    }
}

const MEH_GAME_METHOD_MODULES = Object.freeze([
    MehGameProductMethods,
    MehGameInviteMethods,
    MehGameTableMethods,
    MehGameGuidanceMethods,
    MehGameProfileMethods,
    MehGameAuthoritativeMethods,
    MehGameOnlineMethods,
    MehGameScreenMethods,
    MehGameRuleMethods,
    MehGameRendererMethods,
]);

for (const methodModule of MEH_GAME_METHOD_MODULES) {
    const descriptors = Object.getOwnPropertyDescriptors(methodModule);
    for (const methodName of Reflect.ownKeys(descriptors)) {
        if (Object.prototype.hasOwnProperty.call(MehGame.prototype, methodName)) {
            throw new Error(`Duplicate MehGame method: ${String(methodName)}`);
        }
        const descriptor = descriptors[methodName];
        descriptor.configurable = true;
        if (Object.prototype.hasOwnProperty.call(descriptor, 'writable')) descriptor.writable = true;
        Object.defineProperty(MehGame.prototype, methodName, descriptor);
    }
}

document.addEventListener('DOMContentLoaded', () => { window.game = new MehGame(); });
