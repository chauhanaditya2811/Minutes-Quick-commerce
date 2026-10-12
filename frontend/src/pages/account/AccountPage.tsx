import { useAuth } from '../../context/AuthContext';
import DeliveryDetailsForm from '../../components/checkout/DeliveryDetailsForm';
import Notice from '../../components/ui/Notice';

export default function AccountPage() {
  const { profile, firebaseUser, profileError, signOut } = useAuth();
  const photo = profile?.profileImage ?? firebaseUser?.photoURL ?? null;

  return (
    <div className="page page--narrow">
      <section className="panel">
        <div className="account-head">
          {photo ? <img className="avatar avatar--lg" src={photo} alt="" referrerPolicy="no-referrer" /> : <span className="avatar avatar--lg avatar--default" aria-hidden="true" />}
          <div>
            <h1>Your account</h1>
            <p className="muted">{profile?.email ?? firebaseUser?.email ?? 'Not signed in'}</p>
          </div>
        </div>
        <h2>Hostel delivery details</h2>
        <p className="muted">We deliver to your room. Please fill out all the fields.</p>
        {profileError && <Notice tone="error">{profileError}</Notice>}
        <DeliveryDetailsForm submitLabel="Save details" />
        {firebaseUser && (
          <button type="button" className="btn btn--outline" onClick={() => void signOut()}>Log out</button>
        )}
      </section>
    </div>
  );
}
