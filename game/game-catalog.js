'use strict';

class MehGameCatalogModule {
    _initializeCatalogRuntime() {
        this._catalogState = null;
        this._catalogLoading = null;
        this._catalogRoom = null;
        this._catalogSeats = [];
        this._catalogView = 'store';
    }

    bindCatalogEvents() {
        const get = id => document.getElementById(id);
        const on = (id, event, handler) => {
            const element = get(id);
            if (element) element.addEventListener(event, handler);
        };
        const button = get('catalog-btn');
        if (button) {
            this._syncCatalogEntryVisibility();
            button.addEventListener('click', () => this._openCardCatalog());
        }
        on('catalog-back-btn', 'click', () => this.showScreen('main-menu'));
        on('catalog-refresh-btn', 'click', () => this._loadCardCatalog(true));
        on('catalog-store-tab', 'click', () => this._setCatalogView('store'));
        on('catalog-collection-tab', 'click', () => this._setCatalogView('collection'));
        on('catalog-store-tab', 'keydown', event => this._handleCatalogTabKey(event));
        on('catalog-collection-tab', 'keydown', event => this._handleCatalogTabKey(event));
        on('friendly-card-select', 'change', () => this._syncFriendlyReplacementOptions());
        on('friendly-recipe-apply', 'click', () => this._applyFriendlyContribution());
        on('friendly-recipe-clear', 'click', () => this._clearFriendlyContribution());
    }

    _syncCatalogEntryVisibility() {
        const button = document.getElementById('catalog-btn');
        if (!button) return false;
        const profile = Storage.getCurrentProfile();
        const games = profile && profile.stats && Number.isSafeInteger(profile.stats.games)
            ? profile.stats.games : 0;
        const visible = games > 0
            && this._productFeatureEnabled('card_catalog')
            && this._productFeatureEnabled('tamashi_wallet')
            && this._authoritativeServiceAvailable();
        button.classList.toggle('hidden', !visible);
        return visible;
    }

    async _openCardCatalog() {
        this._setCatalogView('store');
        this.showScreen('catalog-screen');
        await this._loadCardCatalog(true);
    }

    async _loadCardCatalog(force = false) {
        if (!force && this._catalogState) return this._catalogState;
        if (this._catalogLoading) return this._catalogLoading;
        const status = document.getElementById('catalog-status');
        if (status) status.textContent = I18n.t('catalog_loading');
        this._catalogLoading = (async () => {
            try {
                await this._ensureAuthoritativeClient();
                const state = await AuthoritativeAccountClient.getCatalog(
                    this._authoritativeHttpUrl, this._authoritativeAccessToken,
                );
                if (state.catalogVersion !== MEH_CATALOG_MANIFEST.catalogVersion
                    || state.rulesVersion !== MEH_CORE_MANIFEST.rulesVersion) {
                    throw new AuthoritativeClientError('CATALOG_UPDATE_REQUIRED');
                }
                this._catalogState = state;
                this._renderCardCatalog();
                this._trackProductEvent('catalog.viewed', {
                    cardCount: Math.min(256, state.cards.length),
                    unlockedCount: Math.min(256, state.cards.filter(card => card.unlocked).length),
                });
                this._trackProductEvent('economy.balance_viewed', {
                    balanceBand: this._tamashiBalanceBand(state.currency.balance),
                });
                if (this._catalogRoom) this._renderFriendlyRecipe(this._catalogRoom, this._catalogSeats);
                return state;
            } catch (error) {
                if (status) status.textContent = I18n.t(
                    error.code === 'CATALOG_UPDATE_REQUIRED' ? 'catalog_update_required' : 'catalog_load_failed',
                );
                return null;
            } finally {
                this._catalogLoading = null;
            }
        })();
        return this._catalogLoading;
    }

    _renderCardCatalog() {
        const state = this._catalogState;
        const list = document.getElementById('catalog-list');
        const status = document.getElementById('catalog-status');
        const balance = document.querySelector('#tamashi-balance strong');
        if (!state || !list) return;
        if (status) status.textContent = '';
        if (balance) balance.textContent = new Intl.NumberFormat(I18n.lang === 'ar' ? 'ar' : 'en').format(
            state.currency.balance,
        );
        const earning = state.policy && state.policy.earning || {};
        const rewardBindings = [
            ['tamashi-completion-reward', 'completionReward'],
            ['tamashi-healthy-reward', 'healthyParticipationReward'],
            ['tamashi-win-reward', 'winBonus'],
        ];
        rewardBindings.forEach(([elementId, policyKey]) => {
            const element = document.getElementById(elementId);
            if (element) element.textContent = `+${new Intl.NumberFormat(I18n.lang === 'ar' ? 'ar' : 'en')
                .format(Number(earning[policyKey]) || 0)}`;
        });
        const earningNote = document.getElementById('tamashi-earn-note');
        if (earningNote) earningNote.textContent = I18n.t('earn_tamashi_policy_note', {
            count: Number(earning.minimumHumanSeats) || 2,
        });
        const storeCards = state.cards.filter(card => !card.includedByDefault);
        const collectionCards = state.cards.filter(card => card.includedByDefault || card.unlocked);
        const storeCount = document.getElementById('catalog-store-count');
        const collectionCount = document.getElementById('catalog-collection-count');
        if (storeCount) storeCount.textContent = String(storeCards.length);
        if (collectionCount) collectionCount.textContent = String(collectionCards.length);
        const visibleCards = this._catalogView === 'collection' ? collectionCards : storeCards;
        const calibrationNote = document.getElementById('catalog-calibration-note');
        if (calibrationNote) calibrationNote.classList.toggle('hidden', this._catalogView !== 'store');
        list.setAttribute('aria-labelledby', this._catalogView === 'collection'
            ? 'catalog-collection-tab' : 'catalog-store-tab');
        list.replaceChildren();
        if (!visibleCards.length && this._catalogView === 'store') {
            list.appendChild(this._catalogEmptyState());
            return;
        }
        visibleCards.forEach(card => list.appendChild(this._catalogCard(card)));
    }

    _setCatalogView(view) {
        if (!['store', 'collection'].includes(view)) return;
        this._catalogView = view;
        ['store', 'collection'].forEach(name => {
            const selected = name === view;
            const button = document.getElementById(`catalog-${name}-tab`);
            if (!button) return;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        if (this._catalogState) this._renderCardCatalog();
    }

    _handleCatalogTabKey(event) {
        const actions = {
            ArrowLeft: 'collection',
            ArrowRight: 'store',
            Home: 'store',
            End: 'collection',
        };
        const view = actions[event.key];
        if (!view) return;
        event.preventDefault();
        this._setCatalogView(view);
        const button = document.getElementById(`catalog-${view}-tab`);
        if (button) button.focus();
    }

    _catalogEmptyState() {
        const section = document.createElement('section');
        section.className = 'store-empty-state';
        const icon = document.createElement('span');
        icon.className = 'store-empty-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🏪';
        const title = document.createElement('h3');
        title.textContent = I18n.t('store_empty_title');
        const body = document.createElement('p');
        body.textContent = I18n.t('store_empty_body');
        section.append(icon, title, body);
        return section;
    }

    _refreshCatalogLocalization() {
        if (this._catalogState) this._renderCardCatalog();
        if (this._catalogRoom) this._renderFriendlyRecipe(this._catalogRoom, this._catalogSeats);
    }

    _catalogCard(card) {
        const article = document.createElement('article');
        article.className = `catalog-card${card.unlocked ? ' unlocked' : ''}`;
        const image = document.createElement('img');
        const color = card.replacementClass === 'black-wild' ? 'black' : 'orange';
        image.src = `assets/cards/${color}-${card.assetBase}.webp`;
        image.alt = this._catalogCardName(card);
        const body = document.createElement('div');
        body.className = 'catalog-card-body';
        const heading = document.createElement('div');
        heading.className = 'catalog-card-heading';
        const title = document.createElement('strong');
        title.textContent = this._catalogCardName(card);
        const badge = document.createElement('span');
        badge.className = 'catalog-badge';
        badge.textContent = I18n.t(card.inFreeRotation
            ? 'free_rotation' : (card.unlocked ? 'card_unlocked' : 'card_locked'));
        heading.append(title, badge);
        const effect = document.createElement('p');
        effect.textContent = this._catalogLocalized(card.design && card.design.effect)
            || I18n.cardDesc(card.nameAr) || I18n.t('classic_card');
        body.append(heading, effect);
        if (card.design) {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = I18n.t('card_lab');
            const decision = document.createElement('p');
            decision.textContent = `${I18n.t('card_decision')}: ${this._catalogLocalized(card.design.decision)}`;
            const counter = document.createElement('p');
            counter.textContent = `${I18n.t('card_counterplay')}: ${this._catalogLocalized(card.design.counterplay)}`;
            details.append(summary, decision, counter);
            body.appendChild(details);
        }
        if (card.purchasable && !card.unlocked) {
            const buy = document.createElement('button');
            buy.type = 'button';
            buy.className = 'btn secondary-btn catalog-buy';
            buy.textContent = I18n.t('unlock_for_tamashi', { amount: card.tamashiPrice });
            buy.disabled = this._catalogState.currency.balance < card.tamashiPrice;
            buy.addEventListener('click', () => this._unlockCatalogCard(card, buy));
            body.appendChild(buy);
        }
        article.append(image, body);
        return article;
    }

    _catalogCardName(card) {
        if (I18n.lang === 'ar') return card.nameAr;
        const known = I18n.cards[card.nameAr];
        return (known && known.en) || (card.design && card.design.accessibilityLabel.en) || card.nameAr;
    }

    _catalogLocalized(value) {
        return value && value[I18n.lang === 'ar' ? 'ar' : 'en'] || '';
    }

    _tamashiBalanceBand(value) {
        const balance = Math.max(0, Number(value) || 0);
        if (balance === 0) return 'zero';
        if (balance < 500) return '1-499';
        if (balance < 1_000) return '500-999';
        if (balance < 2_000) return '1000-1999';
        if (balance < 5_000) return '2000-4999';
        return '5000-plus';
    }

    async _unlockCatalogCard(card, button) {
        if (!button || button.disabled) return;
        button.disabled = true;
        this._trackProductEvent('catalog.unlock', {
            result: 'started', definitionId: card.definitionId,
        });
        try {
            await AuthoritativeAccountClient.unlockCard(
                this._authoritativeHttpUrl,
                this._authoritativeAccessToken,
                card.definitionId,
                this._catalogRequestId('unlock'),
            );
            await this._loadCardCatalog(true);
            this._trackProductEvent('catalog.unlock', {
                result: 'completed', definitionId: card.definitionId,
            });
            this.showToast(I18n.t('card_unlock_success'));
        } catch (error) {
            button.disabled = false;
            this._trackProductEvent('catalog.unlock', {
                result: 'failed', definitionId: card.definitionId,
                reason: String(error.code || 'unknown').slice(0, 48),
            });
            this.showToast(I18n.t(error.code === 'INSUFFICIENT_TAMASHI'
                ? 'insufficient_tamashi' : 'catalog_action_failed'));
        }
    }

    _catalogRequestId(prefix) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
        }
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    }

    _syncFriendlyRecipeFromSnapshot(room, seats) {
        this._catalogRoom = room;
        this._catalogSeats = seats;
        const enabled = this._productFeatureEnabled('friendly_recipes')
            && this._authoritativeServiceAvailable() && room.mode === 'private' && room.phase === 'FORMING';
        const section = document.getElementById('friendly-recipe');
        if (section) section.classList.toggle('hidden', !enabled);
        if (!enabled) return;
        this._renderFriendlyRecipe(room, seats);
        if (!this._catalogState) void this._loadCardCatalog(false);
    }

    _renderFriendlyRecipe(room, seats) {
        const summary = document.getElementById('friendly-recipe-summary');
        const controls = document.getElementById('friendly-recipe-controls');
        if (!summary || !controls) return;
        const contributions = room.recipe && room.recipe.contributions || [];
        summary.replaceChildren();
        const recipeName = document.createElement('strong');
        recipeName.textContent = contributions.length
            ? I18n.t('custom_shared_recipe', { count: contributions.length })
            : I18n.t('classic_shared_recipe');
        summary.appendChild(recipeName);
        contributions.forEach(contribution => {
            const row = document.createElement('span');
            const seat = seats.find(item => item.seatId === contribution.seatId);
            row.textContent = I18n.t('recipe_replacement', {
                player: seat ? seat.displayName : I18n.t('guest'),
                added: this._definitionName(contribution.definitionId),
                removed: this._definitionName(contribution.replacesDefinitionId),
            });
            summary.appendChild(row);
        });
        const eligible = this._friendlyEligibleCards();
        controls.classList.toggle('hidden', !eligible.length);
        if (!eligible.length) {
            const note = document.createElement('small');
            note.textContent = I18n.t('no_friendly_cards');
            summary.appendChild(note);
            return;
        }
        const select = document.getElementById('friendly-card-select');
        const previous = select.value;
        select.replaceChildren();
        eligible.forEach(card => {
            const option = document.createElement('option');
            option.value = card.definitionId;
            option.textContent = this._catalogCardName(card);
            select.appendChild(option);
        });
        if (eligible.some(card => card.definitionId === previous)) select.value = previous;
        this._syncFriendlyReplacementOptions();
    }

    _friendlyEligibleCards() {
        return this._catalogState ? this._catalogState.cards.filter(card => !card.includedByDefault
            && (card.unlocked || card.inFreeRotation)
            && ['friendly-5', 'live'].includes(card.releaseStatus)) : [];
    }

    _syncFriendlyReplacementOptions() {
        const selectedId = document.getElementById('friendly-card-select').value;
        const replacement = document.getElementById('friendly-replacement-select');
        const selected = this._friendlyEligibleCards().find(card => card.definitionId === selectedId);
        replacement.replaceChildren();
        if (!selected || !this._catalogState) return;
        this._catalogState.cards.filter(card => card.includedByDefault
            && card.replacementClass === selected.replacementClass
            && card.powerBudget === selected.powerBudget).forEach(card => {
            const option = document.createElement('option');
            option.value = card.definitionId;
            option.textContent = this._catalogCardName(card);
            replacement.appendChild(option);
        });
    }

    async _applyFriendlyContribution() {
        const definitionId = document.getElementById('friendly-card-select').value;
        const replacesDefinitionId = document.getElementById('friendly-replacement-select').value;
        if (!definitionId || !replacesDefinitionId || !this._authoritativeClient) return;
        try {
            await this._authoritativeClient.contributeRecipe(definitionId, replacesDefinitionId);
            this._trackProductEvent('recipe.contribution_changed', {
                action: 'set', definitionId,
                contributionCount: Math.min(4, Number(
                    this._catalogRoom && this._catalogRoom.recipe
                    && this._catalogRoom.recipe.contributions.length || 0,
                ) + 1),
            });
        } catch (error) {
            this.showToast(I18n.t(error.code === 'TABLE_CATALOG_UPDATE_REQUIRED'
                ? 'table_catalog_update_required' : 'catalog_action_failed'));
        }
    }

    async _clearFriendlyContribution() {
        if (!this._authoritativeClient) return;
        try {
            await this._authoritativeClient.clearRecipeContribution();
            this._trackProductEvent('recipe.contribution_changed', {
                action: 'clear',
                contributionCount: Math.max(0, Number(
                    this._catalogRoom && this._catalogRoom.recipe
                    && this._catalogRoom.recipe.contributions.length || 0,
                ) - 1),
            });
        }
        catch (error) { this.showToast(I18n.t('catalog_action_failed')); }
    }

    _definitionName(definitionId) {
        const card = this._catalogState && this._catalogState.cards
            .find(item => item.definitionId === definitionId);
        if (card) return this._catalogCardName(card);
        const definition = MEH_CATALOG_MANIFEST.definitions.find(item => item.definitionId === definitionId);
        if (!definition) return definitionId;
        return I18n.lang === 'ar' ? definition.nameAr
            : ((I18n.cards[definition.nameAr] || {}).en || definition.nameAr);
    }
}

const MehGameCatalogMethods = MehGameCatalogModule.prototype;
delete MehGameCatalogMethods.constructor;
Object.freeze(MehGameCatalogMethods);
