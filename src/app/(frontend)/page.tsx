/* eslint-disable @next/next/no-img-element -- brand SVGs are served as-is, no optimisation needed */

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="container site-header__inner">
          <img
            className="site-header__logo"
            src="/brand/logo-horizontal.svg"
            alt="Хозяин Камчатки"
            width={254}
            height={76}
          />
          <span className="site-header__tag">Икра · Рыба · Морепродукты</span>
        </div>
      </header>

      <main className="hero">
        <div className="container hero__inner">
          <p className="hero__eyebrow">Красноярск · 10 магазинов</p>
          <h1 className="hero__title">Икра и рыбные деликатесы с&nbsp;Камчатки</h1>
          <p className="hero__text">
            Мы готовим новый сайт с каталогом, ценами вашего магазина и доставкой. Пока он в разработке, ждём
            вас в магазинах «Хозяин Камчатки» и в нашем мобильном приложении.
          </p>
        </div>
        <svg className="hero__waves" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 30 Q 50 0 100 30 T 200 30 T 300 30 T 400 30 T 500 30 T 600 30 T 700 30 T 800 30 T 900 30 T 1000 30 T 1100 30 T 1200 30" />
          <path d="M0 50 Q 50 20 100 50 T 200 50 T 300 50 T 400 50 T 500 50 T 600 50 T 700 50 T 800 50 T 900 50 T 1000 50 T 1100 50 T 1200 50" />
        </svg>
      </main>

      <footer className="site-footer">
        <div className="container">© «Хозяин Камчатки»</div>
      </footer>
    </>
  )
}
