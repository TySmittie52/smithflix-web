import { buildCustomColorScheme } from 'themes/utils';

/** The SyncWave TV color scheme: near-black with SyncWave purple and lavender accents. */
const theme = buildCustomColorScheme({
    palette: {
        primary: {
            main: '#9B5CFF',
            dark: '#6D28D9',
            light: '#E59DFF'
        },
        secondary: {
            main: '#E59DFF'
        },
        background: {
            default: '#0E0A18',
            paper: '#1A1330'
        },
        text: {
            primary: '#F1ECFA',
            secondary: 'rgba(241, 236, 250, 0.72)'
        },
        action: {
            focus: '#9B5CFF',
            hover: 'rgba(155, 92, 255, 0.18)'
        },
        AppBar: {
            defaultBg: 'rgba(14, 10, 24, 0.72)'
        },
        Button: {
            inheritContainedBg: 'rgba(255, 255, 255, 0.08)',
            inheritContainedHoverBg: 'rgba(155, 92, 255, 0.28)'
        },
        SnackbarContent: {
            bg: '#1A1330',
            color: '#F1ECFA'
        }
    }
});

export default theme;
