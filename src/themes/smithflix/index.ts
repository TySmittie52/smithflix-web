import { buildCustomColorScheme } from 'themes/utils';

/** The "Smithflix" color scheme: deep navy with the Smithflix blue/cyan accents. */
const theme = buildCustomColorScheme({
    palette: {
        primary: {
            main: '#1C8CFF',
            dark: '#0A63F2',
            light: '#0FE6FF'
        },
        secondary: {
            main: '#0FE6FF'
        },
        background: {
            default: '#090C14',
            paper: '#111A2C'
        },
        text: {
            primary: '#E9EEF8',
            secondary: 'rgba(233, 238, 248, 0.72)'
        },
        action: {
            focus: '#1C8CFF',
            hover: 'rgba(28, 140, 255, 0.18)'
        },
        AppBar: {
            defaultBg: 'rgba(9, 12, 20, 0.72)'
        },
        Button: {
            inheritContainedBg: 'rgba(255, 255, 255, 0.08)',
            inheritContainedHoverBg: 'rgba(28, 140, 255, 0.28)'
        },
        SnackbarContent: {
            bg: '#111A2C',
            color: '#E9EEF8'
        }
    }
});

export default theme;
