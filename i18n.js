/* ============================================================
   i18n.js — نظام الترجمة (عربي / إنجليزي)
   - I18n.t(key, params)  → نص مترجم
   - I18n.setLang('en')   → تبديل اللغة + الاتجاه (RTL/LTR)
   - data-i18n="key"      → يُترجم تلقائياً في HTML
   ============================================================ */

const I18n = {
    lang: 'ar',

    dict: {
        ar: {
            // القائمة
            subtitle: 'لعبة ورقية بطابع بحريني',
            play: 'العب',
            instructions: 'التعليمات',
            settings: 'الإعدادات',
            profiles: 'الأعضاء',
            // التعليمات
            instructions_title: '📖 تعليمات اللعبة',
            goal_title: '🎯 هدف اللعبة',
            goal_text: 'التخلص من جميع بطاقاتك قبل اللاعبين الآخرين عبر مطابقة <strong>الألوان</strong> أو <strong>الشخصيات</strong>.',
            colors_title: '🎨 الألوان',
            special_cards_title: '🃏 البطاقات المميزة',
            power_cards_title: '⚡ بطاقات القوى الخارقة',
            back: '🔙 رجوع',
            // الألوان
            orange: 'برتقالي',
            gray: 'رمادي',
            purple: 'بنفسجي',
            black: 'أسود (خاص)',
            // اللعبة
            turn: 'دور:',
            you: 'أنت',
            choose_color: 'اختر لوناً',
            choose_player: 'اختر لاعباً',
            choose: 'اختر',
            new_color_chosen: 'اختر لوناً جديداً 🎨',
            // النهاية
            you_win: '🎉 مبروك فزت!',
            bot_win: 'فاز {name}! 😢 حظ أوفر',
            play_again: '🔄 العب مرة ثانية',
            main_menu: '🏠 القائمة الرئيسية',
            // رسائل اللعب
            last_card: 'آخر ورقة!',
            no_card_draw: 'لا تملك ورقة! سحب تلقائي...',
            reshuffling: 'جاري خلط الأوراق...',
            skips_turn: '{name} يتخطى دوره!',
            drew_two: '{name} سحب بطاقتين',
            drew_n: '{name} سحب {n} بطاقات!',
            counter_bounce: '⚡ ارتدّت على {name}! (+{n})',
            drew_card: '{name} سحب ورقة!',
            discarded_extra: '{name} تخلص من ورقة إضافية!',
            discarded_n: '{name} رمى {n} بطاقات',
            gave_card: '{name} أعطى ورقة لـ {target}',
            gave_card_you: 'أعطيت {target} ورقة!',
            pick_give: 'اختر ورقة لتعطيها (اضغط عليها)',
            pick_discard: 'اختر ورقة إضافية للتخلص منها',
            discarded_done: 'تم التخلص من الورقة!',
            cancel_draw: 'تم إلغاء السحب! 🦇 محصّن ضد السحب القادم',
            phantom_shield: '🦇 {name} محمي بالفانتوم — لا سحب!',
            powers_disabled: 'القوى الخارقة معطلة هذا الدور!',
            best_one_choice: 'اختر عقوبة {name}:',
            throw_two: 'يرمي بطاقتين',
            draw_two: 'يسحب بطاقتين',
            um_choice: 'اختر وجه أم وجهين لـ {name}:',
            um_discard: 'يتخلص من ورقة ❤️',
            um_draw: 'يسحب ورقة 😈',
            chose_color: '{name} اختار {color}',
            confirm_play: '✓ ارمِ',
            cancel: '✗ إلغاء',
            // الإعدادات
            settings_title: '⚙️ الإعدادات',
            lang_label: '🌐 اللغة',
            colorblind_label: '👁️ مراعاة عمى الألوان',
            colorblind_desc: 'إضافة رموز للألوان لتمييزها بسهولة',
            battery_label: '🔋 وضع توفير البطارية',
            battery_desc: 'إيقاف الحركات والتأثيرات لتوفير الطاقة',
            wakelock_label: '☀️ منع نوم الشاشة',
            wakelock_desc: 'إبقاء الشاشة مضاءة أثناء اللعب',
            confirm_label: '✋ تأكيد قبل رمي البطاقة',
            confirm_desc: 'ضغطة للمعاينة ثم تأكيد الرمي',
            sound_label: '🔊 المؤثرات الصوتية',
            sound_desc: 'أصوات السحب والرمي والفوز',
            done: 'تم',
            // الأعضاء
            profile_title: '👤 الأعضاء',
            create_profile: '➕ عضو جديد',
            enter_name: 'اكتب اسمك',
            choose_avatar: 'اختر صورتك',
            save: 'حفظ',
            wins: 'فوز',
            losses: 'خسارة',
            games: 'مباراة',
            welcome: 'أهلاً {name}! 👋',
            select_profile: 'اختر عضواً للعب',
            guest: 'ضيف',
            // إيموجي
            send_emoji: 'أرسل إيموجي',
            // أونلاين
            online_play: 'أونلاين',
            online_title: '🌐 اللعب أونلاين',
            online_hint: 'العب مع أصدقائك بكود غرفة',
            create_room: '➕ إنشاء غرفة',
            or: 'أو',
            enter_room_code: 'اكتب كود الغرفة',
            join_room: '🚪 دخول غرفة',
            lobby_title: '🛋️ الردهة',
            room_code: 'كود الغرفة',
            lobby_hint: 'شارك الكود مع أصدقائك لينضمّوا',
            start_game: '▶️ ابدأ اللعبة',
            waiting_host: 'بانتظار أن يبدأ المضيف...',
            leave: '🚪 خروج',
            connecting: 'جاري الاتصال...',
            creating_room: 'جاري إنشاء الغرفة...',
            conn_error: 'تعذّر الاتصال — تأكد من الكود وحاول ثانية',
            code_copied: 'تم نسخ الكود! 📋',
            net_player_joined: '{name} انضمّ! 👋',
            net_player_left: '{name} خرج',
            no_peerjs: 'تعذّر تحميل خدمة الاتصال — تأكد من الإنترنت',
            // رسائل منبثقة على الطاولة
            m_freeze: '🛑 انثبر!',
            m_uturn: '🔄 يوتيرن!',
            m_sorry: 'أنا آسف! 🤜',
            m_counter: '⚡ هجمة مرتدة!',
            m_drama: '👸 دراما كوين!',
            m_captain: '⚓ النوخذة!',
            m_plato: '🏛️ أفلاطون!',
            m_chameleon: '🦎 الحرباية!',
            m_boshlakh: '🗣️ بوشلاخ!',
            m_hamour: '🦈 الهامور!',
            m_sugar: '🍬 شوقر!',
            m_um: '🎭 أم وجهين!',
            m_phantom: '🦇 فانتوم!',
            m_meh: 'مِهْ! 🃏',
            m_draw4: '📜 شنو كنت تقول؟!',
            m_wild: '📺 طلعت يا محلى نورها!',
            m_bestone: '🌳 انت احسن واحد!',
            m_meh_win: 'مِهْ! 🎉',
            m_plus: '+{n}',
        },
        en: {
            subtitle: 'A Bahraini-style card game',
            play: 'Play',
            instructions: 'Instructions',
            settings: 'Settings',
            profiles: 'Players',
            instructions_title: '📖 How to Play',
            goal_title: '🎯 Objective',
            goal_text: 'Be the first to get rid of all your cards by matching <strong>colors</strong> or <strong>characters</strong>.',
            colors_title: '🎨 Colors',
            special_cards_title: '🃏 Special Cards',
            power_cards_title: '⚡ Superpower Cards',
            back: '🔙 Back',
            orange: 'Orange',
            gray: 'Gray',
            purple: 'Purple',
            black: 'Black (special)',
            turn: 'Turn:',
            you: 'You',
            choose_color: 'Choose a color',
            choose_player: 'Choose a player',
            choose: 'Choose',
            new_color_chosen: 'Choose a new color 🎨',
            you_win: '🎉 You Win!',
            bot_win: '{name} won! 😢 Better luck next time',
            play_again: '🔄 Play Again',
            main_menu: '🏠 Main Menu',
            last_card: 'Last card!',
            no_card_draw: 'No playable card! Drawing...',
            reshuffling: 'Shuffling the deck...',
            skips_turn: '{name} skips their turn!',
            drew_two: '{name} drew two cards',
            drew_n: '{name} drew {n} cards!',
            counter_bounce: '⚡ Bounced to {name}! (+{n})',
            drew_card: '{name} drew a card!',
            discarded_extra: '{name} discarded an extra card!',
            discarded_n: '{name} discarded {n} cards',
            gave_card: '{name} gave a card to {target}',
            gave_card_you: 'You gave {target} a card!',
            pick_give: 'Pick a card to give (tap it)',
            pick_discard: 'Pick an extra card to discard',
            discarded_done: 'Card discarded!',
            cancel_draw: 'Draw cancelled! 🦇 immune to the next draw',
            phantom_shield: '🦇 {name} is shielded by Phantom — no draw!',
            powers_disabled: 'Superpowers are disabled this turn!',
            best_one_choice: "Choose {name}'s penalty:",
            throw_two: 'Discard two',
            draw_two: 'Draw two',
            um_choice: 'Choose the Two-Faced effect for {name}:',
            um_discard: 'Discards a card ❤️',
            um_draw: 'Draws a card 😈',
            chose_color: '{name} chose {color}',
            confirm_play: '✓ Play',
            cancel: '✗ Cancel',
            settings_title: '⚙️ Settings',
            lang_label: '🌐 Language',
            colorblind_label: '👁️ Color-blind friendly',
            colorblind_desc: 'Add symbols to colors for easy distinction',
            battery_label: '🔋 Battery saver',
            battery_desc: 'Disable animations & effects to save power',
            wakelock_label: '☀️ Keep screen awake',
            wakelock_desc: 'Prevent the screen from sleeping while playing',
            confirm_label: '✋ Confirm before playing a card',
            confirm_desc: 'Tap to preview, then confirm the play',
            sound_label: '🔊 Sound effects',
            sound_desc: 'Draw, play, and win sounds',
            done: 'Done',
            profile_title: '👤 Players',
            create_profile: '➕ New Player',
            enter_name: 'Enter your name',
            choose_avatar: 'Pick your avatar',
            save: 'Save',
            wins: 'Wins',
            losses: 'Losses',
            games: 'Games',
            welcome: 'Welcome {name}! 👋',
            select_profile: 'Pick a player to start',
            guest: 'Guest',
            send_emoji: 'Send emoji',
            online_play: 'Online',
            online_title: '🌐 Play Online',
            online_hint: 'Play with friends using a room code',
            create_room: '➕ Create Room',
            or: 'or',
            enter_room_code: 'Enter room code',
            join_room: '🚪 Join Room',
            lobby_title: '🛋️ Lobby',
            room_code: 'Room code',
            lobby_hint: 'Share the code with friends to join',
            start_game: '▶️ Start Game',
            waiting_host: 'Waiting for the host to start...',
            leave: '🚪 Leave',
            connecting: 'Connecting...',
            creating_room: 'Creating room...',
            conn_error: 'Connection failed — check the code and try again',
            code_copied: 'Code copied! 📋',
            net_player_joined: '{name} joined! 👋',
            net_player_left: '{name} left',
            no_peerjs: 'Could not load the connection service — check your internet',
            m_freeze: '🛑 Freeze!',
            m_uturn: '🔄 U-Turn!',
            m_sorry: "I'm Sorry! 🤜",
            m_counter: '⚡ Counter Attack!',
            m_drama: '👸 Drama Queen!',
            m_captain: '⚓ The Captain!',
            m_plato: '🏛️ Plato!',
            m_chameleon: '🦎 Chameleon!',
            m_boshlakh: '🗣️ Bo-Shlakh!',
            m_hamour: '🦈 The Hamour!',
            m_sugar: '🍬 Sugar!',
            m_um: '🎭 Two-Faced!',
            m_phantom: '🦇 Phantom!',
            m_meh: 'Meh! 🃏',
            m_draw4: "📜 What'd You Say?!",
            m_wild: '📺 Wild!',
            m_bestone: "🌳 You're the Best!",
            m_meh_win: 'Meh! 🎉',
            m_plus: '+{n}',
        },
    },

    // أسماء البطاقات: المفتاح = الاسم العربي الثابت (للمطابقة)، القيمة = { ar, en, desc_ar, desc_en }
    cards: {
        'اسكت اسكت':            { en: 'Hush Hush',        desc_ar: 'التالي يسحب 2',                desc_en: 'Next draws 2' },
        'افلاطون':              { en: 'Plato',            desc_ar: 'تخطي دورك القادم',             desc_en: 'Skip your next turn' },
        'الحرباية':             { en: 'Chameleon',        desc_ar: 'أعط ورقة لأي لاعب',            desc_en: 'Give a card to any player' },
        'الدافور':              { en: 'Al-Dafoor',        desc_ar: '',                              desc_en: '' },
        'الرجل الصندوق':        { en: 'Box Man',          desc_ar: '',                              desc_en: '' },
        'النوخذه':              { en: 'The Captain',      desc_ar: 'الدور يرجع لك',                desc_en: 'Turn comes back to you' },
        'الهامور':              { en: 'The Hamour',       desc_ar: 'خذ 4 بطاقات من المرمي',        desc_en: 'Take 4 cards from discard' },
        'انت احسن واحد':        { en: "You're the Best",  desc_ar: 'التالي يرمي 2 أو يسحب 2',      desc_en: 'Next discards 2 or draws 2' },
        'انثبر مكانك':          { en: 'Freeze!',          desc_ar: 'تخطي اللاعب التالي',           desc_en: 'Skip the next player' },
        'أنا آسف':              { en: "I'm Sorry",        desc_ar: 'أنت تسحب 2 (عقاب ذاتي!)',      desc_en: 'You draw 2 (self penalty!)' },
        'ام حمار':              { en: 'Um Humar',         desc_ar: '',                              desc_en: '' },
        'ام كشة':               { en: 'Um Kasha',         desc_ar: '',                              desc_en: '' },
        'ام وجهين':             { en: 'Two-Faced',        desc_ar: 'لاعب يتخلص أو يسحب ورقة',      desc_en: 'A player discards or draws' },
        'بوشلاخ':               { en: 'Bo-Shlakh',        desc_ar: 'تخلص من ورقة إضافية',          desc_en: 'Discard an extra card' },
        'دراما كوين':           { en: 'Drama Queen',      desc_ar: 'تخطي لاعبين!',                 desc_en: 'Skip two players!' },
        'شوقر':                 { en: 'Sugar',            desc_ar: 'تعطيل القوى لدورة',            desc_en: 'Disable powers for a round' },
        'فانتوم':               { en: 'Phantom',          desc_ar: 'ألغِ أي ورقة سحب',             desc_en: 'Cancel any draw card' },
        'يوتيرن':               { en: 'U-Turn',           desc_ar: 'عكس اتجاه اللعب',              desc_en: 'Reverse play direction' },
        'هجمة مرتدة':           { en: 'Counter Attack',   desc_ar: 'السابق يسحب 2',                desc_en: 'Previous player draws 2' },
        'مه':                   { en: 'Meh',              desc_ar: 'التالي يسحب 1 + تختار اللون',  desc_en: 'Next draws 1 + pick color' },
        'شنو كنت تقول':         { en: "What'd You Say?!", desc_ar: 'التالي يسحب 4 + تختار اللون',  desc_en: 'Next draws 4 + pick color' },
        'طلعت يا محلى نورها':   { en: 'Wild',             desc_ar: 'تختار لون البطاقة التالية',    desc_en: 'Pick the next card color' },
    },

    t(key, params) {
        let str = (this.dict[this.lang] && this.dict[this.lang][key]) || (this.dict.ar[key]) || key;
        if (params) {
            for (const k in params) str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
        }
        return str;
    },

    // اسم البطاقة حسب اللغة الحالية
    cardName(card) {
        if (this.lang === 'ar') return card.name;
        const entry = this.cards[card.name];
        return (entry && entry.en) || card.name;
    },
    cardDesc(arabicName) {
        const entry = this.cards[arabicName];
        if (!entry) return '';
        return this.lang === 'ar' ? entry.desc_ar : entry.desc_en;
    },
    colorName(c) {
        return this.t(c) || c;
    },

    setLang(lang) {
        this.lang = lang;
        document.documentElement.lang = lang;
        document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
        this.apply();
    },

    // تطبيق الترجمة على كل عناصر data-i18n
    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const html = el.getAttribute('data-i18n-html');
            if (html !== null) el.innerHTML = this.t(key);
            else el.textContent = this.t(key);
        });
        document.querySelectorAll('[data-i18n-attr]').forEach(el => {
            // صيغة: "placeholder:enter_name"
            const spec = el.getAttribute('data-i18n-attr');
            const [attr, key] = spec.split(':');
            if (attr && key) el.setAttribute(attr, this.t(key));
        });
    },
};

window.I18n = I18n;
