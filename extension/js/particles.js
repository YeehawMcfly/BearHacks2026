/**
 * Particle Effects for SGT CAPTCHA
 * Spawns canvas-based particles on top of the overlay
 */
(function() {
  function spawn(type, shadowRoot) {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '350'; // Above overlay, below terms
    
    const overlay = shadowRoot.getElementById('rt-overlay');
    if (!overlay) return;
    
    overlay.appendChild(canvas);
    
    const ctx = canvas.getContext('2d');
    canvas.width = overlay.clientWidth;
    canvas.height = overlay.clientHeight;
    
    const particles = [];
    const colors = type === 'ban' 
      ? ['#ff2d2d', '#ff0000', '#cc0000', '#ff6b6b'] 
      : ['#10b981', '#34d399', '#059669', '#06b6d4', '#3b82f6'];
      
    const count = type === 'ban' ? 80 : 150;
    
    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * (type === 'ban' ? 30 : 20),
        vy: (Math.random() - 0.5) * (type === 'ban' ? 30 : 20) - (type === 'success' ? 5 : 0),
        size: Math.random() * 5 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
        decay: Math.random() * 0.02 + 0.01,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2,
        shape: Math.random() > 0.5 ? 'square' : 'circle'
      });
    }
    
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      let alive = false;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.life <= 0) continue;
        
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        
        // Gravity
        p.vy += type === 'success' ? 0.3 : 0.5;
        
        // Friction
        p.vx *= 0.95;
        p.vy *= 0.95;
        
        // Sway for confetti
        if (type === 'success') {
          p.x += Math.sin(p.life * 10) * 2;
          p.rotation += p.rotSpeed;
        }
        
        p.life -= p.decay;
        
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        
        ctx.save();
        ctx.translate(p.x, p.y);
        if (type === 'success') {
          ctx.rotate(p.rotation);
          if (p.shape === 'square') {
            ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      
      if (alive) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    }
    
    animate();
  }
  
  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Particles = { spawn };
})();
