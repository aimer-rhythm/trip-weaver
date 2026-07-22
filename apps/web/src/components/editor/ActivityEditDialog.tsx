import { useState, type FormEvent } from 'react';
import { ACTIVITY_CATEGORIES, type Activity, type ActivityCategory } from '@tripweaver/shared';
import { useEditorStore } from '../../store/editorStore';
import { Modal } from '../Modal';

interface Props {
  dayId: string;
  activity: Activity | null;   // null = 新增
  onClose: () => void;
}

export function ActivityEditDialog({ dayId, activity, onClose }: Props) {
  const addActivity = useEditorStore((s) => s.addActivity);
  const updateActivity = useEditorStore((s) => s.updateActivity);

  const [name, setName] = useState(activity?.name ?? '');
  const [startTime, setStartTime] = useState(activity?.startTime ?? '');
  const [endTime, setEndTime] = useState(activity?.endTime ?? '');
  const [description, setDescription] = useState(activity?.description ?? '');
  const [lat, setLat] = useState(activity ? String(activity.lat) : '');
  const [lng, setLng] = useState(activity ? String(activity.lng) : '');
  const [category, setCategory] = useState<ActivityCategory>(activity?.category ?? '其他');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const latNum = lat.trim() === '' ? 0 : Number(lat);
    const lngNum = lng.trim() === '' ? 0 : Number(lng);
    if (!name.trim()) return setError('请填写活动名称');
    if (Number.isNaN(latNum) || latNum < -90 || latNum > 90) return setError('纬度需在 -90 ~ 90 之间');
    if (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) return setError('经度需在 -180 ~ 180 之间');

    const coordChanged = activity && (latNum !== activity.lat || lngNum !== activity.lng);
    const patch = {
      name: name.trim(),
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      description: description.trim(),
      lat: latNum,
      lng: lngNum,
      category,
      // 手工改坐标后来源标记为 manual
      coordSource: (activity ? (coordChanged ? 'manual' : activity.coordSource) : 'manual') as Activity['coordSource'],
    };
    if (activity) {
      updateActivity(dayId, activity.id, patch);
    } else {
      addActivity(dayId, { ...patch, sourceNotes: [] });
    }
    onClose();
  };

  return (
    <Modal title={activity ? '编辑活动' : '添加活动'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：外滩漫步" />
        </label>
        <div className="form-grid-2">
          <label>
            开始时间
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label>
            结束时间
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <label>
          介绍
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="一句话介绍或游玩建议" />
        </label>
        <div className="form-grid-2">
          <label>
            纬度 lat
            <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="31.2403" />
          </label>
          <label>
            经度 lng
            <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="121.4905" />
          </label>
        </div>
        <label>
          类别
          <select value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory)}>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary">
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
