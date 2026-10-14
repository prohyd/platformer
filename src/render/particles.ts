export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  g: number;
  drag: number;
  shape: 'circle' | 'square' | 'spark' | 'ring' | 'star';
  rot: number;
  vr: number;
  glow: boolean;
}

export interface BurstOpts {
  n?: number;
  color?: string | string[];
  speed?: number;
  spread?: number;
  angle?: number;
  size?: number;
  life?: number;
  g?: number;
  drag?: number;
  shape?: Particle['shape'];
  glow?: boolean;
}

export class Particles {
  list: Particle[] = [];

  add(p: Partial<Particle> & { x: number; y: number }) {
    if (this.list.length > 900) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      life: 0.6,
      max: p.life ?? 0.6,
      size: 3,
      color: '#fff',
      g: 0,
      drag: 0,
      shape: 'circle',
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 10,
      glow: false,
      ...p,
    });
  }

  burst(x: number, y: number, o: BurstOpts = {}) {
    const n = o.n ?? 10;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#fff'];
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = (o.speed ?? 120) * (0.4 + Math.random() * 0.8);
      const life = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.add({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        size: (o.size ?? 3) * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        g: o.g ?? 0,
        drag: o.drag ?? 2,
        shape: o.shape ?? 'circle',
        glow: o.glow ?? false,
      });
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      const k = Math.max(0, p.life / p.max);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
      }
      const s = p.size * (p.shape === 'ring' ? 1 + (1 - k) * 4 : 0.4 + k * 0.6);
      switch (p.shape) {
        case 'circle':
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'square':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-s, -s, s * 2, s * 2);
          ctx.restore();
          break;
        case 'spark': {
          ctx.lineWidth = Math.max(1, s * 0.5);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
          ctx.stroke();
          break;
        }
        case 'ring':
          ctx.lineWidth = 2 * k;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'star': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 ? s * 0.4 : s;
            const a = (i / 8) * Math.PI * 2;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.fill();
          ctx.restore();
          break;
        }
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}
