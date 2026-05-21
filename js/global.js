const isMobile = () => window.innerWidth <= 768;
let darkmodeState;

window.onload = () => {
    const savedState = localStorage.getItem("darkmode");
    if (savedState == "true") darkmodeState = 1;
    else if (savedState == "false") darkmodeState = 0;
    else darkmodeState = 2; // follow system
    toggleDarkMode();

    document.documentElement.classList.add("no-transition");
    requestAnimationFrame(() => {
        document.documentElement.classList.remove("no-transition");
    }); // disable transitions initially, re-enable afterwards
}

window.addEventListener('pagehide', function (e) {
    if (!e.persisted) {
        // discard page
        document.querySelectorAll('table').forEach(t => {
            const clone = t.cloneNode(false);
            t.parentNode.replaceChild(clone, t);
        });
        document.documentElement.innerHTML = '';
    }
}); // seems to lower RAM usage

function toggleDarkMode() {
    const target = document.documentElement;
    const icons = [
        document.querySelector(".indicatorMoon"),
        document.querySelector(".indicatorSystem"),
        document.querySelector(".indicatorSun")
    ]
    switch (darkmodeState % 3) {
        case 0:
            target.classList.remove("dark");
            localStorage.setItem("darkmode", "false");
            break;
        case 1:
            target.classList.add("dark");
            localStorage.setItem("darkmode", "true");
            break;
        case 2:
            const darkThemeMq = window.matchMedia("(prefers-color-scheme: dark)");
            if (darkThemeMq.matches) target.classList.add("dark");
            else target.classList.remove("dark");
            localStorage.setItem("darkmode", "system");
            break;
        default: target.classList.remove("dark");
    }

    for (let i = 0; i < icons.length; i++) {
        if (darkmodeState % 3 == i) icons[i].classList.remove("hidden");
        else icons[i].classList.add("hidden");
    }
    darkmodeState++;
}