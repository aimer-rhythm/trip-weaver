import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Field';
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
      // 旧行程时刻原样保留，新活动不创建定时排程。
      startTime: activity?.startTime ?? '',
      endTime: activity?.endTime ?? '',
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
      <form onSubmit={submit} className={"form flex flex-col [gap:12px] [&_label]:flex [&_label]:flex-col [&_label]:[gap:5px] [&_label]:[font-size:0.88rem] [&_label]:[color:var(--color-muted)]"}>
        <label>
          名称
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="如：外滩漫步" />
        </label>
        <label>
          介绍
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="一句话介绍或游玩建议" />
        </label>
        <div className={"form-grid-2 grid [grid-template-columns:1fr_1fr] [gap:10px]"}>
          <label>
            纬度 lat
            <Input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="31.2403" />
          </label>
          <label>
            经度 lng
            <Input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="121.4905" />
          </label>
        </div>
        <label>
          类别
          <Select value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory)}>
            {ACTIVITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
        {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
        <div className={"form-foot flex items-center [justify-content:flex-end] [gap:12px]"}>
          <Button variant="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" type="submit">
            保存
          </Button>
        </div>
      </form>
    </Modal>
  );
}
