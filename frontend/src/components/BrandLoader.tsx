"use client";

export default function BrandLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="brand-loader">
      <div className="brand-loader-stage">
        {/* rotating conic ring */}
        <div className="brand-loader-ring" />
        {/* pulsing glow */}
        <div className="brand-loader-glow" />
        {/* logo */}
        <div className="brand-loader-logo">
          <span className="brand-loader-c">C</span>
          <span className="brand-loader-dot" />
        </div>
      </div>
      <div className="brand-loader-label">{label}</div>

      <style jsx>{`
        .brand-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 22px;
          padding: 80px 24px;
          flex: 1;
        }
        .brand-loader-stage {
          position: relative;
          width: 120px;
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .brand-loader-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            transparent 0deg,
            rgba(0, 229, 160, 0) 60deg,
            rgba(0, 229, 160, 0.4) 180deg,
            #00e5a0 300deg,
            transparent 360deg
          );
          animation: brand-spin 1.6s linear infinite;
          mask: radial-gradient(circle, transparent 52%, #000 54%);
          -webkit-mask: radial-gradient(circle, transparent 52%, #000 54%);
        }
        .brand-loader-glow {
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            rgba(0, 229, 160, 0.35) 0%,
            rgba(0, 229, 160, 0.1) 40%,
            transparent 70%
          );
          animation: brand-pulse 2s ease-in-out infinite;
          filter: blur(8px);
        }
        .brand-loader-logo {
          position: relative;
          display: flex;
          align-items: baseline;
          gap: 3px;
          z-index: 2;
        }
        .brand-loader-c {
          font-family: var(--font);
          font-size: 48px;
          font-weight: 900;
          line-height: 1;
          color: var(--dark);
          letter-spacing: -2px;
          animation: brand-breathe 2s ease-in-out infinite;
        }
        .brand-loader-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #00e5a0;
          box-shadow:
            0 0 0 0 rgba(0, 229, 160, 0.6),
            0 0 18px rgba(0, 229, 160, 0.7);
          animation: brand-dot 1.6s ease-in-out infinite;
        }
        .brand-loader-label {
          font-family: var(--font);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: var(--gray-500);
          position: relative;
          overflow: hidden;
          padding: 0 6px;
        }
        .brand-loader-label::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(0, 229, 160, 0.25) 50%,
            transparent 100%
          );
          animation: brand-shimmer 2s linear infinite;
        }

        @keyframes brand-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes brand-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes brand-breathe {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.04); opacity: 1; }
        }
        @keyframes brand-dot {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0, 229, 160, 0.6), 0 0 18px rgba(0, 229, 160, 0.7);
          }
          50% {
            transform: scale(1.3);
            box-shadow: 0 0 0 10px rgba(0, 229, 160, 0), 0 0 24px rgba(0, 229, 160, 1);
          }
        }
        @keyframes brand-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
