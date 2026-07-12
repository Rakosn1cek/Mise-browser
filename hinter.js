(function() {
    if (window.hasHinter) return;
    window.hasHinter = true;

    window.toggleHints = function() {
        const existing = document.getElementById('mise-hint-layer');
        if (existing) { 
            existing.remove(); 
            document.removeEventListener('keydown', window.hintKeyListener, true);
            return; 
        }

        // Left hand cluster array, avoiding standard hjkl placement entirely
        const charset = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c', 'r', 'f', 'v'];
        const links = Array.from(document.querySelectorAll('a, button, input, textarea, select, [role="button"]'));
        
        const visible = links.filter(l => {
            const rect = l.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top <= window.innerHeight;
        });

        if (visible.length === 0) return;

        const layer = document.createElement('div');
        layer.id = 'mise-hint-layer';
        document.body.appendChild(layer);

        let activeHints = {};
        let keysPressed = "";

        visible.forEach((el, index) => {
            const first = charset[Math.floor(index / charset.length) % charset.length];
            const second = charset[index % charset.length];
            const code = first + second;
            
            activeHints[code] = el;

            const rect = el.getBoundingClientRect();
            const badge = document.createElement('div');
            badge.textContent = code;
            
            // Matches the accent colour from the Python theme dictionary
            badge.style.cssText = `
                position: absolute; left: ${rect.left + window.scrollX}px; top: ${rect.top + window.scrollY}px;
                background: #2ac3de; color: #1a1b26; padding: 2px 5px; font-size: 13px;
                font-weight: 900; border-radius: 4px; z-index: 2147483647; font-family: monospace;
                text-transform: uppercase; border: 1px solid #1a1b26;
            `;
            layer.appendChild(badge);
        });

        window.hintKeyListener = function(e) {
            if (e.key === 'Escape') {
                layer.remove();
                document.removeEventListener('keydown', window.hintKeyListener, true);
                return;
            }

            const key = e.key.toLowerCase();
            if (charset.includes(key)) {
                e.preventDefault();
                e.stopPropagation();
                keysPressed += key;

                if (activeHints[keysPressed]) {
                    activeHints[keysPressed].click();
                    activeHints[keysPressed].focus();
                    layer.remove();
                    document.removeEventListener('keydown', window.hintKeyListener, true);
                } else if (keysPressed.length >= 2) {
                    keysPressed = "";
                }
            }
        };

        document.addEventListener('keydown', window.hintKeyListener, true);
    };
})();
