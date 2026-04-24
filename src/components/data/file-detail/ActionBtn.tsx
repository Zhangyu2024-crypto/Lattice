export default function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'transparent',
        border: '1px solid #333',
        color: '#ccc',
        fontSize: "var(--text-xxs)",
        padding: '3px 8px',
        borderRadius: 3,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#555' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#333' }}
    >
      {icon} {label}
    </button>
  )
}
